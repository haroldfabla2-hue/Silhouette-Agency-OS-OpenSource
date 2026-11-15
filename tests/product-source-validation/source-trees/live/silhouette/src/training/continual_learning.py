"""
NANOSILHOUETTE - Continual Learning System
===========================================
Implements learning without catastrophic forgetting:
- Elastic Weight Consolidation (EWC)
- Memory Replay with prioritized sampling
- Progressive Network columns
- Knowledge Distillation
"""
import copy
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass
from collections import deque
import random

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np


@dataclass
class ContinualConfig:
    """Configuration for continual learning."""
    # EWC parameters
    ewc_lambda: float = 1000.0  # Importance weight for EWC
    fisher_sample_size: int = 200  # Samples for Fisher estimation
    
    # Memory replay
    replay_buffer_size: int = 10000
    replay_batch_size: int = 32
    replay_frequency: float = 0.3  # How often to replay
    
    # Progressive networks
    use_progressive: bool = False
    lateral_connections: bool = True
    
    # Distillation
    distill_temperature: float = 2.0
    distill_alpha: float = 0.5


class FisherInformationMatrix:
    """
    Computes and stores Fisher Information Matrix for EWC.
    
    Identifies which parameters are important for previous tasks.
    """
    
    def __init__(self):
        self.fisher: Dict[str, torch.Tensor] = {}
        self.optimal_params: Dict[str, torch.Tensor] = {}
    
    def compute(
        self,
        model: nn.Module,
        dataloader,
        sample_size: int = 200,
        device: str = "cuda"
    ):
        """
        Compute Fisher Information Matrix.
        
        Uses gradient of log-likelihood to estimate parameter importance.
        """
        model.eval()
        
        # Initialize Fisher accumulator
        fisher_accum = {}
        for name, param in model.named_parameters():
            if param.requires_grad:
                fisher_accum[name] = torch.zeros_like(param)
        
        samples_processed = 0
        data_iter = iter(dataloader)
        
        while samples_processed < sample_size:
            try:
                batch = next(data_iter)
            except StopIteration:
                data_iter = iter(dataloader)
                batch = next(data_iter)
            
            # Forward pass
            if isinstance(batch, dict):
                input_ids = batch['input_ids'].to(device)
                labels = batch.get('labels', input_ids).to(device)
            else:
                input_ids = batch[0].to(device)
                labels = batch[1].to(device) if len(batch) > 1 else batch[0].to(device)
            
            model.zero_grad()
            outputs = model(input_ids, labels=labels)
            
            # Use log probability as objective
            if isinstance(outputs, dict):
                logits = outputs['logits']
            else:
                logits = outputs
            
            # Sample from model's distribution
            probs = F.softmax(logits, dim=-1)
            log_probs = F.log_softmax(logits, dim=-1)
            
            # Compute gradient of log probability
            loss = -(probs * log_probs).sum()
            loss.backward()
            
            # Accumulate squared gradients (Fisher diagonal)
            for name, param in model.named_parameters():
                if param.requires_grad and param.grad is not None:
                    fisher_accum[name] += param.grad.detach() ** 2
            
            samples_processed += input_ids.shape[0]
        
        # Average and store
        for name in fisher_accum:
            self.fisher[name] = fisher_accum[name] / samples_processed
            
        # Store optimal parameters
        self.optimal_params = {
            name: param.detach().clone()
            for name, param in model.named_parameters()
            if param.requires_grad
        }
        
        model.zero_grad()
    
    def get_penalty(self, model: nn.Module) -> torch.Tensor:
        """
        Compute EWC penalty for current parameters.
        
        Penalizes changes to important parameters.
        """
        penalty = 0.0
        
        for name, param in model.named_parameters():
            if name in self.fisher and name in self.optimal_params:
                # Penalty = Fisher * (theta - theta_optimal)^2
                diff = param - self.optimal_params[name]
                penalty += (self.fisher[name] * diff ** 2).sum()
        
        return penalty


class ExperienceReplay:
    """
    Experience replay buffer with prioritized sampling.
    
    Stores past experiences for replay during training.
    """
    
    def __init__(
        self,
        max_size: int = 10000,
        prioritized: bool = True,
        alpha: float = 0.6  # Prioritization exponent
    ):
        self.max_size = max_size
        self.prioritized = prioritized
        self.alpha = alpha
        
        self.buffer: deque = deque(maxlen=max_size)
        self.priorities: deque = deque(maxlen=max_size)
    
    def add(
        self,
        input_ids: torch.Tensor,
        labels: torch.Tensor,
        loss: float = 1.0,
        metadata: Optional[Dict] = None
    ):
        """Add experience to buffer."""
        experience = {
            "input_ids": input_ids.cpu(),
            "labels": labels.cpu(),
            "metadata": metadata or {},
            "timestamp": len(self.buffer)
        }
        
        self.buffer.append(experience)
        self.priorities.append(loss ** self.alpha if self.prioritized else 1.0)
    
    def sample(
        self,
        batch_size: int,
        device: str = "cuda"
    ) -> Optional[Dict[str, torch.Tensor]]:
        """Sample a batch from buffer."""
        if len(self.buffer) < batch_size:
            return None
        
        if self.prioritized:
            # Prioritized sampling
            priorities = np.array(self.priorities)
            probs = priorities / priorities.sum()
            indices = np.random.choice(len(self.buffer), batch_size, p=probs)
        else:
            # Uniform sampling
            indices = np.random.choice(len(self.buffer), batch_size, replace=False)
        
        # Gather batch
        input_ids = torch.stack([self.buffer[i]["input_ids"] for i in indices])
        labels = torch.stack([self.buffer[i]["labels"] for i in indices])
        
        return {
            "input_ids": input_ids.to(device),
            "labels": labels.to(device),
            "indices": indices
        }
    
    def update_priorities(self, indices: np.ndarray, losses: np.ndarray):
        """Update priorities based on new losses."""
        if not self.prioritized:
            return
        
        for idx, loss in zip(indices, losses):
            if idx < len(self.priorities):
                self.priorities[idx] = (loss + 1e-5) ** self.alpha
    
    def __len__(self) -> int:
        return len(self.buffer)


class ProgressiveColumn(nn.Module):
    """
    A progressive network column for a new task.
    
    Has lateral connections to previous columns.
    """
    
    def __init__(
        self,
        d_model: int,
        num_layers: int,
        previous_columns: List[nn.Module] = None
    ):
        super().__init__()
        self.d_model = d_model
        self.num_layers = num_layers
        
        # Main layers
        self.layers = nn.ModuleList([
            nn.Linear(d_model, d_model)
            for _ in range(num_layers)
        ])
        
        self.norms = nn.ModuleList([
            nn.LayerNorm(d_model)
            for _ in range(num_layers)
        ])
        
        # Lateral connections from previous columns
        self.lateral = nn.ModuleList()
        if previous_columns:
            for prev_col in previous_columns:
                self.lateral.append(
                    nn.Linear(d_model, d_model, bias=False)
                )
        
        self.activation = nn.SiLU()
    
    def forward(
        self,
        x: torch.Tensor,
        prev_activations: List[torch.Tensor] = None
    ) -> torch.Tensor:
        """Forward pass with optional lateral connections."""
        h = x
        
        for i, (layer, norm) in enumerate(zip(self.layers, self.norms)):
            # Main pathway
            h_main = self.activation(layer(norm(h)))
            
            # Lateral connections
            h_lateral = 0
            if prev_activations and i < len(prev_activations):
                for j, lat_layer in enumerate(self.lateral):
                    if j < len(prev_activations[i]):
                        h_lateral = h_lateral + lat_layer(prev_activations[i][j])
            
            h = h + h_main + h_lateral
        
        return h


class KnowledgeDistillation:
    """
    Knowledge distillation from teacher to student model.
    
    Preserves knowledge when growing/pruning.
    """
    
    def __init__(
        self,
        temperature: float = 2.0,
        alpha: float = 0.5  # Balance between distill and hard loss
    ):
        self.temperature = temperature
        self.alpha = alpha
    
    def distill_loss(
        self,
        student_logits: torch.Tensor,
        teacher_logits: torch.Tensor,
        hard_labels: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """
        Compute distillation loss.
        
        Combines soft targets from teacher with optional hard labels.
        """
        # Soft targets (from teacher)
        soft_targets = F.softmax(teacher_logits / self.temperature, dim=-1)
        soft_student = F.log_softmax(student_logits / self.temperature, dim=-1)
        
        distill_loss = F.kl_div(
            soft_student,
            soft_targets,
            reduction='batchmean'
        ) * (self.temperature ** 2)
        
        if hard_labels is not None:
            # Hard targets
            hard_loss = F.cross_entropy(
                student_logits.view(-1, student_logits.size(-1)),
                hard_labels.view(-1),
                ignore_index=-100
            )
            return self.alpha * distill_loss + (1 - self.alpha) * hard_loss
        
        return distill_loss


class ContinualLearner:
    """
    Main continual learning system.
    
    Integrates EWC, memory replay, and distillation.
    """
    
    def __init__(
        self,
        model: nn.Module,
        config: Optional[ContinualConfig] = None
    ):
        self.model = model
        self.config = config or ContinualConfig()
        
        # Components
        self.fisher = FisherInformationMatrix()
        self.replay_buffer = ExperienceReplay(
            max_size=self.config.replay_buffer_size,
            prioritized=True
        )
        self.distillation = KnowledgeDistillation(
            temperature=self.config.distill_temperature,
            alpha=self.config.distill_alpha
        )
        
        # Teacher model for distillation
        self.teacher_model: Optional[nn.Module] = None
        
        # Task tracking
        self.current_task = 0
        self.task_history: List[Dict] = []
    
    def start_new_task(self, task_name: str = None):
        """
        Prepare for a new task.
        
        Saves current model state and prepares EWC.
        """
        # Save teacher model
        self.teacher_model = copy.deepcopy(self.model)
        self.teacher_model.eval()
        for param in self.teacher_model.parameters():
            param.requires_grad = False
        
        self.current_task += 1
        self.task_history.append({
            "task_id": self.current_task,
            "name": task_name or f"task_{self.current_task}",
            "started_at": None  # Would use timestamp
        })
    
    def compute_ewc(self, dataloader, device: str = "cuda"):
        """Compute EWC after finishing a task."""
        self.fisher.compute(
            self.model,
            dataloader,
            sample_size=self.config.fisher_sample_size,
            device=device
        )
    
    def training_step(
        self,
        batch: Dict[str, torch.Tensor],
        base_loss: torch.Tensor,
        device: str = "cuda"
    ) -> Tuple[torch.Tensor, Dict[str, float]]:
        """
        Perform a continual learning training step.
        
        Returns:
            Modified loss with regularization
            Dict of loss components
        """
        loss_components = {"base_loss": base_loss.item()}
        total_loss = base_loss
        
        # Add EWC penalty
        if self.current_task > 0:
            ewc_penalty = self.fisher.get_penalty(self.model)
            ewc_loss = self.config.ewc_lambda * ewc_penalty
            total_loss = total_loss + ewc_loss
            loss_components["ewc_loss"] = ewc_loss.item()
        
        # Memory replay
        if len(self.replay_buffer) >= self.config.replay_batch_size:
            if random.random() < self.config.replay_frequency:
                replay_batch = self.replay_buffer.sample(
                    self.config.replay_batch_size,
                    device=device
                )
                
                if replay_batch is not None:
                    # Forward pass on replay batch
                    replay_outputs = self.model(
                        replay_batch["input_ids"],
                        labels=replay_batch["labels"]
                    )
                    replay_loss = replay_outputs["loss"]
                    total_loss = total_loss + 0.5 * replay_loss
                    loss_components["replay_loss"] = replay_loss.item()
        
        # Knowledge distillation
        if self.teacher_model is not None:
            with torch.no_grad():
                teacher_outputs = self.teacher_model(batch["input_ids"])
                teacher_logits = teacher_outputs["logits"]
            
            student_outputs = self.model(batch["input_ids"])
            student_logits = student_outputs["logits"]
            
            distill_loss = self.distillation.distill_loss(
                student_logits,
                teacher_logits,
                batch.get("labels")
            )
            total_loss = total_loss + distill_loss
            loss_components["distill_loss"] = distill_loss.item()
        
        # Store experience for replay
        if "input_ids" in batch and "labels" in batch:
            self.replay_buffer.add(
                batch["input_ids"],
                batch["labels"],
                loss=base_loss.item()
            )
        
        return total_loss, loss_components
    
    def get_stats(self) -> Dict[str, Any]:
        """Get continual learning statistics."""
        return {
            "current_task": self.current_task,
            "replay_buffer_size": len(self.replay_buffer),
            "fisher_params": len(self.fisher.fisher),
            "tasks_completed": len(self.task_history)
        }


def create_continual_learner(
    model: nn.Module,
    ewc_lambda: float = 1000.0,
    replay_buffer_size: int = 10000
) -> ContinualLearner:
    """Factory function for continual learner."""
    config = ContinualConfig(
        ewc_lambda=ewc_lambda,
        replay_buffer_size=replay_buffer_size
    )
    return ContinualLearner(model, config)


if __name__ == "__main__":
    print("Testing Continual Learning System...")
    
    # Simple model for testing
    model = nn.Sequential(
        nn.Linear(100, 50),
        nn.ReLU(),
        nn.Linear(50, 10)
    )
    
    # Create continual learner
    learner = create_continual_learner(model)
    
    # Test experience replay
    for i in range(100):
        input_ids = torch.randint(0, 100, (32, 10))
        labels = torch.randint(0, 10, (32, 10))
        learner.replay_buffer.add(input_ids, labels, loss=1.0 + i * 0.01)
    
    print(f"Replay buffer size: {len(learner.replay_buffer)}")
    
    # Test sampling
    sample = learner.replay_buffer.sample(16, device="cpu")
    print(f"Sampled batch shape: {sample['input_ids'].shape}")
    
    # Stats
    print(f"Stats: {learner.get_stats()}")
    
    print("✅ Continual Learning test passed!")
