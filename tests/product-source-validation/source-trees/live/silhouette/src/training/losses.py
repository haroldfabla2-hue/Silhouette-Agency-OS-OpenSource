"""
NANOSILHOUETTE - Loss Functions
Combined losses: Cross-Entropy + InfoNCE (JEPA) + Introspection Consistency
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Dict, Optional


class NanoSilhouetteLoss(nn.Module):
    """Combined loss function for NANOSILHOUETTE training."""
    
    def __init__(
        self,
        ce_weight: float = 1.0,
        jepa_weight: float = 0.1,
        introspection_weight: float = 0.01,
        label_smoothing: float = 0.0
    ):
        super().__init__()
        self.ce_weight = ce_weight
        self.jepa_weight = jepa_weight
        self.introspection_weight = introspection_weight
        self.label_smoothing = label_smoothing
    
    def forward(
        self,
        model_outputs: Dict[str, torch.Tensor],
        labels: torch.Tensor,
        vocab_size: int
    ) -> Dict[str, torch.Tensor]:
        """
        Compute combined loss.
        
        Args:
            model_outputs: Dict from model forward pass
            labels: Target token IDs
            vocab_size: Vocabulary size for CE loss
        
        Returns:
            Dict with total_loss and individual components
        """
        losses = {}
        total_loss = torch.tensor(0.0, device=labels.device)
        
        # Cross-entropy loss (main LM objective)
        if "logits" in model_outputs:
            logits = model_outputs["logits"]
            ce_loss = F.cross_entropy(
                logits.view(-1, vocab_size),
                labels.view(-1),
                ignore_index=-100,
                label_smoothing=self.label_smoothing
            )
            losses["ce_loss"] = ce_loss
            total_loss = total_loss + self.ce_weight * ce_loss
        
        # JEPA InfoNCE loss
        if "jepa_loss" in model_outputs:
            jepa_loss = model_outputs["jepa_loss"]
            losses["jepa_loss"] = jepa_loss
            total_loss = total_loss + self.jepa_weight * jepa_loss
        
        # Introspection consistency loss
        if "introspection" in model_outputs:
            intro = model_outputs["introspection"]
            if "self_report" in intro:
                # Encourage stable self-reports (low variance)
                report = intro["self_report"]
                intro_loss = report.var(dim=0).mean()
                losses["introspection_loss"] = intro_loss
                total_loss = total_loss + self.introspection_weight * intro_loss
        
        losses["total_loss"] = total_loss
        return losses


class InfoNCELoss(nn.Module):
    """Standalone InfoNCE contrastive loss."""
    
    def __init__(self, temperature: float = 0.07):
        super().__init__()
        self.temperature = temperature
    
    def forward(
        self, 
        predictions: torch.Tensor,
        targets: torch.Tensor
    ) -> torch.Tensor:
        """
        Args:
            predictions: (batch, dim) normalized embeddings
            targets: (batch, dim) normalized embeddings
        """
        predictions = F.normalize(predictions, dim=-1)
        targets = F.normalize(targets, dim=-1)
        
        similarity = torch.matmul(predictions, targets.T) / self.temperature
        labels = torch.arange(predictions.shape[0], device=predictions.device)
        
        return F.cross_entropy(similarity, labels)
