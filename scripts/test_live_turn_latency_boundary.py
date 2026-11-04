import importlib.util
import pathlib
import struct
import sys
import types
import unittest

# The benchmark imports websocket for production execution. These boundary
# unit tests do not open a socket, so keep the module import dependency-free.
sys.modules.setdefault("websocket", types.SimpleNamespace())

SCRIPT = pathlib.Path(__file__).with_name("live-turn-latency-benchmark.py")
SPEC = importlib.util.spec_from_file_location("live_turn_latency_benchmark", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
BENCHMARK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BENCHMARK)


class SpeechBoundaryTests(unittest.TestCase):
    def test_preserves_natural_tail_but_reports_last_meaningful_frame(self):
        frame_bytes = 16000 * 2 // 100
        pcm = bytearray(frame_bytes * 50)  # 500 ms of PCM16 silence.
        final_active_frame_offset = frame_bytes * 8
        struct.pack_into("<h", pcm, final_active_frame_offset, 1000)

        trimmed, speech_end_offset = BENCHMARK.trim_encoder_tail(bytes(pcm))

        expected_boundary = final_active_frame_offset + frame_bytes
        self.assertEqual(speech_end_offset, expected_boundary)
        self.assertEqual(len(trimmed), expected_boundary + (16000 * 2 * 120 // 1000))
        self.assertGreater(len(trimmed), speech_end_offset)

    def test_all_silence_keeps_the_original_boundary(self):
        pcm = bytes(16000 * 2 // 10)
        trimmed, speech_end_offset = BENCHMARK.trim_encoder_tail(pcm)
        self.assertEqual(trimmed, pcm)
        self.assertEqual(speech_end_offset, len(pcm))

    def test_boundary_is_assigned_to_the_chunk_that_contains_last_speech(self):
        boundary = 6400
        chunk = 1280
        self.assertFalse(BENCHMARK.chunk_reaches_speech_end(0, chunk, boundary))
        self.assertTrue(BENCHMARK.chunk_reaches_speech_end(5120, chunk, boundary))
        self.assertFalse(BENCHMARK.chunk_reaches_speech_end(6400, chunk, boundary))

    def test_boundary_can_fall_on_a_chunk_edge(self):
        self.assertTrue(BENCHMARK.chunk_reaches_speech_end(5120, 1280, 6400))
        self.assertFalse(BENCHMARK.chunk_reaches_speech_end(6400, 1280, 6400))

    def test_early_assistant_audio_is_reported_as_negative_latency(self):
        self.assertEqual(BENCHMARK.speech_end_to_first_audio_ms(9.8, 10.0), -200)

    def test_post_speech_audio_is_reported_as_positive_latency(self):
        self.assertEqual(BENCHMARK.speech_end_to_first_audio_ms(10.25, 10.0), 250)


if __name__ == "__main__":
    unittest.main()
