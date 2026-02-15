"""
NANOSILHOUETTE - Data Loader
Streaming data pipeline for efficient training.
"""
import torch
from torch.utils.data import Dataset, DataLoader, IterableDataset
from typing import Optional, Iterator, List
import os


class TextDataset(Dataset):
    """Simple text dataset from a file."""
    
    def __init__(
        self,
        file_path: str,
        tokenizer,
        max_length: int = 1024,
        stride: int = 512
    ):
        self.tokenizer = tokenizer
        self.max_length = max_length
        self.stride = stride
        
        # Load and tokenize
        with open(file_path, "r", encoding="utf-8") as f:
            text = f.read()
        
        self.tokens = tokenizer.encode(text)
        self.num_samples = max(1, (len(self.tokens) - max_length) // stride + 1)
    
    def __len__(self):
        return self.num_samples
    
    def __getitem__(self, idx):
        start = idx * self.stride
        end = start + self.max_length
        
        tokens = self.tokens[start:end]
        if len(tokens) < self.max_length:
            tokens = tokens + [0] * (self.max_length - len(tokens))
        
        input_ids = torch.tensor(tokens[:-1], dtype=torch.long)
        labels = torch.tensor(tokens[1:], dtype=torch.long)
        
        return {"input_ids": input_ids, "labels": labels}


class StreamingDataset(IterableDataset):
    """Memory-efficient streaming dataset for large files."""
    
    def __init__(
        self,
        file_paths: List[str],
        tokenizer,
        max_length: int = 1024,
        buffer_size: int = 10000
    ):
        self.file_paths = file_paths
        self.tokenizer = tokenizer
        self.max_length = max_length
        self.buffer_size = buffer_size
    
    def __iter__(self) -> Iterator:
        buffer = []
        
        for file_path in self.file_paths:
            with open(file_path, "r", encoding="utf-8") as f:
                for line in f:
                    tokens = self.tokenizer.encode(line.strip())
                    buffer.extend(tokens)
                    
                    while len(buffer) >= self.max_length:
                        chunk = buffer[:self.max_length]
                        buffer = buffer[self.max_length // 2:]  # Overlap
                        
                        input_ids = torch.tensor(chunk[:-1], dtype=torch.long)
                        labels = torch.tensor(chunk[1:], dtype=torch.long)
                        
                        yield {"input_ids": input_ids, "labels": labels}


class SimpleTokenizer:
    """Minimal character-level tokenizer for testing."""
    
    def __init__(self, vocab_size: int = 256):
        self.vocab_size = vocab_size
    
    def encode(self, text: str) -> List[int]:
        return [min(ord(c), self.vocab_size - 1) for c in text]
    
    def decode(self, tokens: List[int]) -> str:
        return "".join(chr(t) for t in tokens if t < 128)


def create_dataloader(
    data_path: str,
    tokenizer=None,
    batch_size: int = 4,
    max_length: int = 1024,
    num_workers: int = 0,
    streaming: bool = False
) -> DataLoader:
    """Create a DataLoader for training."""
    if tokenizer is None:
        tokenizer = SimpleTokenizer()
    
    if streaming:
        if os.path.isdir(data_path):
            files = [os.path.join(data_path, f) for f in os.listdir(data_path) if f.endswith(".txt")]
        else:
            files = [data_path]
        dataset = StreamingDataset(files, tokenizer, max_length)
    else:
        dataset = TextDataset(data_path, tokenizer, max_length)
    
    return DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=not streaming,
        num_workers=num_workers,
        pin_memory=True
    )


if __name__ == "__main__":
    # Quick test with dummy data
    import tempfile
    
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        f.write("Hello world! " * 1000)
        temp_path = f.name
    
    tokenizer = SimpleTokenizer()
    loader = create_dataloader(temp_path, tokenizer, batch_size=2, max_length=128)
    
    batch = next(iter(loader))
    print(f"Input: {batch['input_ids'].shape}, Labels: {batch['labels'].shape}")
    
    os.unlink(temp_path)
    print("✅ DataLoader test passed!")
