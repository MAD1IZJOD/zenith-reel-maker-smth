"""Fixed faster-whisper worker for Zenith. Invoked only by src/lib/transcription/faster-whisper.ts.

Arguments are validated here as well as in Node. Output is JSON written atomically to --output.
Word timestamps are reported exactly as the engine measured them; nothing is interpolated.
"""
import argparse
import json
import os
import sys
import time
import wave

ALLOWED_MODELS = {"tiny", "tiny.en", "base", "base.en", "small", "small.en"}


def load_pcm(file_name):
    """Reads the 16 kHz mono 16-bit WAV produced by FFmpeg. Decoding here avoids PyAV version drift."""
    import numpy as np

    with wave.open(file_name, "rb") as handle:
        if handle.getframerate() != 16000 or handle.getnchannels() != 1 or handle.getsampwidth() != 2:
            raise ValueError("expected 16 kHz mono 16-bit PCM")
        frames = handle.readframes(handle.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default=None)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    from faster_whisper import WhisperModel  # imported after argument parsing so --help stays light

    if args.check:
        print(json.dumps({"ok": True}))
        return 0
    if args.model not in ALLOWED_MODELS:
        print("unsupported model", file=sys.stderr)
        return 2
    if args.language is not None and (len(args.language) > 8 or not args.language.isalpha()):
        print("invalid language", file=sys.stderr)
        return 2
    threads = max(1, min(int(args.threads), 8))

    started = time.time()
    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=threads, num_workers=1)
    segments, info = model.transcribe(
        load_pcm(args.input),
        language=args.language,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400},
        beam_size=1,
        condition_on_previous_text=False,
    )
    output = []
    for segment in segments:
        words = [
            {"text": word.word.strip()[:80], "start": round(float(word.start), 3), "end": round(float(word.end), 3), "probability": round(float(word.probability), 3)}
            for word in (segment.words or [])
            if word.word.strip()
        ]
        output.append({"start": round(float(segment.start), 3), "end": round(float(segment.end), 3), "text": segment.text.strip()[:2000], "words": words})

    result = {
        "version": 1,
        "engine": "faster-whisper",
        "model": args.model,
        "language": info.language,
        "duration": round(float(info.duration), 3),
        "wordTimestamps": True,
        "segments": output,
        "processingSeconds": round(time.time() - started, 2),
    }
    temporary = args.output + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False)
    os.replace(temporary, args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
