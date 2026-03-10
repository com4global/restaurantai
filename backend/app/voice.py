"""
Voice endpoints for Sarvam AI STT + TTS.
POST /api/voice/stt  — receive audio blob, return transcript
POST /api/voice/tts  — receive text, return base64 audio
"""
from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from . import sarvam_service

router = APIRouter(prefix="/api/voice", tags=["voice"])


# ---------- STT ----------

@router.post("/stt")
async def speech_to_text(file: UploadFile = File(...)):
    """Transcribe uploaded audio using Sarvam Saaras v3."""
    audio_bytes = await file.read()
    if len(audio_bytes) == 0:
        raise HTTPException(400, "Empty audio file")
    if len(audio_bytes) > 10 * 1024 * 1024:  # 10MB max
        raise HTTPException(400, "Audio file too large (max 10MB)")

    try:
        result = sarvam_service.transcribe_audio(
            audio_bytes,
            filename=file.filename or "audio.webm",
        )
        return result
    except RuntimeError as e:
        raise HTTPException(502, str(e))


# ---------- TTS ----------

class TTSRequest(BaseModel):
    text: str
    language: str = "en-IN"
    speaker: str = "meera"


@router.post("/tts")
async def text_to_speech(req: TTSRequest):
    """Convert text to speech using Sarvam Bulbul v3."""
    if not req.text.strip():
        raise HTTPException(400, "Text cannot be empty")
    if len(req.text) > 2500:
        # Sarvam v3 limit is 2500 chars
        req.text = req.text[:2500]

    try:
        result = sarvam_service.generate_speech(
            text=req.text,
            language=req.language,
            speaker=req.speaker,
        )
        return result
    except RuntimeError as e:
        raise HTTPException(502, str(e))
