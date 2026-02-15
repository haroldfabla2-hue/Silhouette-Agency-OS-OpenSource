"""
NANOSILHOUETTE - JEPA Head
Predicts continuous embeddings with InfoNCE loss (Meta VL-JEPA).
"""
import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from dataclasses import dataclass


@dataclass
class JEPAConfig:
    d_model: int = 512
    embedding_dim: int = 512
    num_predictor_layers: int = 2
    num_heads: int = 8
    dropout: float = 0.0
    temperature: float = 0.07


class JEPAHead(nn.Module):
    def __init__(self, config: JEPAConfig):
        super().__init__()
        self.config = config
        
        # Query tokens for prediction
        self.query_tokens = nn.Parameter(torch.randn(1, 32, config.embedding_dim) * 0.02)
        
        # Predictor
        self.context_proj = nn.Linear(config.d_model, config.embedding_dim)
        self.predictor = nn.TransformerDecoder(
            nn.TransformerDecoderLayer(
                config.embedding_dim, config.num_heads,
                dim_feedforward=config.embedding_dim * 4,
                dropout=config.dropout, batch_first=True
            ),
            num_layers=config.num_predictor_layers
        )
        self.output_proj = nn.Linear(config.embedding_dim, config.embedding_dim)
        
        # Target encoder (EMA updated, non-trainable)
        self.target_encoder = nn.Sequential(
            nn.Linear(config.d_model, config.embedding_dim),
            nn.LayerNorm(config.embedding_dim),
            nn.SiLU(),
            nn.Linear(config.embedding_dim, config.embedding_dim)
        )
        for p in self.target_encoder.parameters():
            p.requires_grad = False
        
        self.log_temp = nn.Parameter(torch.log(torch.tensor(config.temperature)))
    
    def forward(self, context, target=None):
        batch = context.shape[0]
        queries = self.query_tokens.expand(batch, -1, -1)
        ctx = self.context_proj(context)
        
        pred = self.predictor(queries, ctx)
        pred = self.output_proj(pred)
        
        loss = None
        if target is not None:
            with torch.no_grad():
                tgt_z = self.target_encoder(target).mean(1)
                tgt_z = F.normalize(tgt_z, dim=-1)
            pred_z = F.normalize(pred.mean(1), dim=-1)
            loss = self._info_nce(pred_z, tgt_z)
        
        return pred, loss
    
    def _info_nce(self, pred, target):
        temp = self.log_temp.exp()
        sim = torch.matmul(pred, target.T) / temp
        labels = torch.arange(pred.shape[0], device=pred.device)
        return F.cross_entropy(sim, labels)


if __name__ == "__main__":
    cfg = JEPAConfig()
    jepa = JEPAHead(cfg)
    x = torch.randn(4, 128, 512)
    t = torch.randn(4, 128, 512)
    pred, loss = jepa(x, t)
    print(f"JEPA: pred={pred.shape}, loss={loss.item():.4f}")
