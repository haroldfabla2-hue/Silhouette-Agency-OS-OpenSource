"""
NANOSILHOUETTE - Tokenizer Utilities
=====================================
Proper tokenizer support using HuggingFace tokenizers.
- BPE tokenizer (GPT-2 style)
- SentencePiece fallback
- Character-level for testing
"""
import os
from typing import Optional, List, Union
from pathlib import Path

import torch

try:
    from transformers import AutoTokenizer, PreTrainedTokenizer
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False


class CharacterTokenizer:
    """
    Simple character-level tokenizer for testing.
    
    Not recommended for production - use BPE or SentencePiece instead.
    """
    
    def __init__(self, vocab_size: int = 256):
        self.vocab_size = vocab_size
        self.pad_token_id = 0
        self.eos_token_id = 1
        self.bos_token_id = 2
        self.unk_token_id = 3
    
    def encode(self, text: str, add_special_tokens: bool = True) -> List[int]:
        """Encode text to token IDs."""
        tokens = [min(ord(c), self.vocab_size - 1) for c in text]
        if add_special_tokens:
            tokens = [self.bos_token_id] + tokens
        return tokens
    
    def decode(self, token_ids: List[int], skip_special_tokens: bool = True) -> str:
        """Decode token IDs to text."""
        special = {self.pad_token_id, self.eos_token_id, self.bos_token_id, self.unk_token_id}
        if skip_special_tokens:
            token_ids = [t for t in token_ids if t not in special]
        return ''.join(chr(min(t, 127)) for t in token_ids)
    
    def __call__(
        self,
        text: Union[str, List[str]],
        max_length: Optional[int] = None,
        padding: bool = False,
        truncation: bool = False,
        return_tensors: Optional[str] = None
    ) -> dict:
        """Tokenize text like HuggingFace tokenizers."""
        if isinstance(text, str):
            text = [text]
        
        encoded = [self.encode(t) for t in text]
        
        if truncation and max_length:
            encoded = [e[:max_length] for e in encoded]
        
        if padding:
            max_len = max(len(e) for e in encoded) if not max_length else max_length
            encoded = [e + [self.pad_token_id] * (max_len - len(e)) for e in encoded]
        
        input_ids = encoded
        attention_mask = [[1 if t != self.pad_token_id else 0 for t in e] for e in encoded]
        
        if return_tensors == "pt":
            input_ids = torch.tensor(input_ids)
            attention_mask = torch.tensor(attention_mask)
        
        return {
            "input_ids": input_ids,
            "attention_mask": attention_mask
        }


class NanoSilhouetteTokenizer:
    """
    Tokenizer wrapper for NANOSILHOUETTE.
    
    Supports:
    - HuggingFace pretrained tokenizers (GPT-2, LLaMA, etc.)
    - Custom trained tokenizers
    - Character-level fallback for testing
    """
    
    def __init__(
        self,
        tokenizer_name_or_path: Optional[str] = None,
        vocab_size: int = 32000,
        max_length: int = 2048
    ):
        self.max_length = max_length
        self.vocab_size = vocab_size
        
        if tokenizer_name_or_path and TRANSFORMERS_AVAILABLE:
            try:
                self.tokenizer = AutoTokenizer.from_pretrained(
                    tokenizer_name_or_path,
                    trust_remote_code=True
                )
                self.tokenizer_type = "huggingface"
                self.vocab_size = len(self.tokenizer)
                
                # Set pad token if not present
                if self.tokenizer.pad_token is None:
                    self.tokenizer.pad_token = self.tokenizer.eos_token
                
                print(f"[TOKENIZER] Loaded {tokenizer_name_or_path} (vocab_size={self.vocab_size})")
            except Exception as e:
                print(f"[TOKENIZER] Failed to load {tokenizer_name_or_path}: {e}")
                print("[TOKENIZER] Falling back to character-level tokenizer")
                self.tokenizer = CharacterTokenizer(vocab_size)
                self.tokenizer_type = "character"
        else:
            self.tokenizer = CharacterTokenizer(vocab_size)
            self.tokenizer_type = "character"
            print(f"[TOKENIZER] Using character-level tokenizer (vocab_size={vocab_size})")
    
    @classmethod
    def from_pretrained(cls, name: str, **kwargs) -> "NanoSilhouetteTokenizer":
        """Load a pretrained tokenizer."""
        return cls(tokenizer_name_or_path=name, **kwargs)
    
    @classmethod
    def gpt2(cls, **kwargs) -> "NanoSilhouetteTokenizer":
        """Load GPT-2 tokenizer."""
        return cls(tokenizer_name_or_path="gpt2", **kwargs)
    
    @classmethod
    def llama(cls, **kwargs) -> "NanoSilhouetteTokenizer":
        """Load LLaMA tokenizer (requires access)."""
        return cls(tokenizer_name_or_path="meta-llama/Llama-2-7b-hf", **kwargs)
    
    def encode(
        self,
        text: Union[str, List[str]],
        add_special_tokens: bool = True,
        max_length: Optional[int] = None,
        truncation: bool = True,
        padding: bool = False,
        return_tensors: Optional[str] = None
    ) -> Union[List[int], torch.Tensor, dict]:
        """Encode text to token IDs."""
        max_length = max_length or self.max_length
        
        if self.tokenizer_type == "huggingface":
            output = self.tokenizer(
                text,
                add_special_tokens=add_special_tokens,
                max_length=max_length,
                truncation=truncation,
                padding=padding if padding else False,
                return_tensors=return_tensors
            )
            return output if return_tensors else output["input_ids"]
        else:
            return self.tokenizer(
                text,
                max_length=max_length,
                truncation=truncation,
                padding=padding,
                return_tensors=return_tensors
            )
    
    def decode(
        self,
        token_ids: Union[List[int], torch.Tensor],
        skip_special_tokens: bool = True
    ) -> str:
        """Decode token IDs to text."""
        if isinstance(token_ids, torch.Tensor):
            token_ids = token_ids.tolist()
        
        if self.tokenizer_type == "huggingface":
            return self.tokenizer.decode(token_ids, skip_special_tokens=skip_special_tokens)
        else:
            return self.tokenizer.decode(token_ids, skip_special_tokens=skip_special_tokens)
    
    def __call__(self, *args, **kwargs):
        return self.encode(*args, **kwargs)
    
    @property
    def pad_token_id(self) -> int:
        if self.tokenizer_type == "huggingface":
            return self.tokenizer.pad_token_id or 0
        return self.tokenizer.pad_token_id
    
    @property
    def eos_token_id(self) -> int:
        if self.tokenizer_type == "huggingface":
            return self.tokenizer.eos_token_id or 1
        return self.tokenizer.eos_token_id
    
    @property
    def bos_token_id(self) -> int:
        if self.tokenizer_type == "huggingface":
            return self.tokenizer.bos_token_id or 2
        return self.tokenizer.bos_token_id


def create_tokenizer(
    name: str = "auto",
    vocab_size: int = 32000,
    max_length: int = 2048
) -> NanoSilhouetteTokenizer:
    """
    Factory function to create a tokenizer.
    
    Args:
        name: Tokenizer name. Options:
            - "auto": Try GPT-2, fallback to character
            - "gpt2": OpenAI GPT-2 tokenizer
            - "llama": LLaMA tokenizer
            - "character": Simple character-level
            - Any HuggingFace tokenizer name
    """
    if name == "auto":
        if TRANSFORMERS_AVAILABLE:
            return NanoSilhouetteTokenizer("gpt2", vocab_size=vocab_size, max_length=max_length)
        else:
            return NanoSilhouetteTokenizer(None, vocab_size=vocab_size, max_length=max_length)
    elif name == "character":
        return NanoSilhouetteTokenizer(None, vocab_size=vocab_size, max_length=max_length)
    else:
        return NanoSilhouetteTokenizer(name, vocab_size=vocab_size, max_length=max_length)


if __name__ == "__main__":
    print("Testing Tokenizers...")
    
    # Test character tokenizer
    char_tok = CharacterTokenizer()
    text = "Hello, NANOSILHOUETTE!"
    encoded = char_tok.encode(text)
    decoded = char_tok.decode(encoded)
    print(f"Character: '{text}' -> {encoded[:10]}... -> '{decoded}'")
    
    # Test NanoSilhouette tokenizer
    tok = create_tokenizer("auto")
    result = tok.encode("Hello, world!", return_tensors="pt")
    print(f"Auto tokenizer type: {tok.tokenizer_type}")
    print(f"Encoded: {result}")
    
    # Test batch encoding
    batch = tok.encode(
        ["Hello!", "How are you?"],
        padding=True,
        return_tensors="pt"
    )
    print(f"Batch input_ids shape: {batch['input_ids'].shape}")
    
    print("✅ Tokenizer test passed!")
