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

    def test_relay_keepalive_is_sent_before_the_idle_watchdog_deadline(self):
        class FakeWebSocket:
            def __init__(self):
                self.sent = []

            def send(self, value):
                self.sent.append(value)

        ws = FakeWebSocket()
        self.assertEqual(BENCHMARK.send_relay_keepalive_if_due(ws, 100.0, now=107.9), 100.0)
        self.assertEqual(ws.sent, [])
        self.assertEqual(BENCHMARK.send_relay_keepalive_if_due(ws, 100.0, now=108.0), 108.0)
        self.assertEqual(ws.sent, ['{"keepalive": true}'])

    def test_generation_complete_is_recognized_in_both_protocol_casings(self):
        self.assertTrue(BENCHMARK.generation_complete({"serverContent": {"generationComplete": True}}))
        self.assertTrue(BENCHMARK.generation_complete({"server_content": {"generation_complete": True}}))
        self.assertFalse(BENCHMARK.generation_complete({"serverContent": {"turnComplete": True}}))

    def test_generation_complete_alone_is_not_a_completed_turn(self):
        message = {"serverContent": {"generationComplete": True}}
        self.assertFalse(BENCHMARK.response_generation_finished(message))

    def test_generation_complete_requires_the_later_turn_complete_boundary(self):
        generation = {"serverContent": {"generationComplete": True}}
        turn_end = {"serverContent": {"turnComplete": True, "interactionStatus": "IDLE"}}
        self.assertFalse(BENCHMARK.response_generation_finished(generation))
        self.assertTrue(BENCHMARK.response_generation_finished(turn_end))

    def test_turn_complete_without_interaction_status_is_valid_when_no_processing_is_outstanding(self):
        message = {"serverContent": {"turnComplete": True}}
        self.assertTrue(BENCHMARK.response_generation_finished(message))

    def test_turn_complete_waits_when_provider_explicitly_reports_in_progress(self):
        message = {"serverContent": {"turnComplete": True, "interactionStatus": "IN_PROGRESS"}}
        self.assertFalse(BENCHMARK.response_generation_finished(
            message, turn_complete_seen=True, interaction_in_progress_seen=True
        ))

    def test_generation_complete_does_not_finish_while_interaction_is_in_progress(self):
        generating = {"serverContent": {"generationComplete": True, "interactionStatus": "IN_PROGRESS"}}
        self.assertFalse(BENCHMARK.response_generation_finished(generating))

    def test_turn_complete_seen_then_idle_in_a_later_frame_finishes_response(self):
        completed = {"serverContent": {"turnComplete": True, "interactionStatus": "IN_PROGRESS"}}
        idle = {"serverContent": {"interactionStatus": "IDLE"}}
        self.assertFalse(BENCHMARK.response_generation_finished(
            completed, turn_complete_seen=True, interaction_in_progress_seen=True
        ))
        self.assertTrue(BENCHMARK.response_generation_finished(
            idle, turn_complete_seen=True, interaction_in_progress_seen=False
        ))

    def test_missing_status_after_in_progress_does_not_finish_turn(self):
        completed = {"serverContent": {"turnComplete": True, "interactionStatus": "IN_PROGRESS"}}
        status_missing = {"serverContent": {}}
        self.assertFalse(BENCHMARK.response_generation_finished(
            completed, turn_complete_seen=True, interaction_in_progress_seen=True
        ))
        self.assertFalse(BENCHMARK.response_generation_finished(
            status_missing, turn_complete_seen=True, interaction_in_progress_seen=True
        ))

    def test_turn_complete_is_not_final_while_interaction_is_in_progress(self):
        message = {"serverContent": {"turnComplete": True, "interactionStatus": "IN_PROGRESS"}}
        self.assertTrue(BENCHMARK.turn_complete(message))
        self.assertFalse(BENCHMARK.turn_is_idle(message))

    def test_benchmark_waits_for_idle_after_turn_complete(self):
        message = {"server_content": {"turn_complete": True, "interaction_status": "IDLE"}}
        self.assertTrue(BENCHMARK.turn_is_idle(message))

    def test_idle_without_turn_complete_does_not_finish_a_turn(self):
        message = {"serverContent": {"interactionStatus": "IDLE"}}
        self.assertFalse(BENCHMARK.response_generation_finished(message))

    def test_missing_interaction_status_is_not_treated_as_explicit_idle(self):
        message = {"serverContent": {"turnComplete": True}}
        self.assertTrue(BENCHMARK.turn_complete(message))
        self.assertIsNone(BENCHMARK.interaction_status(message))
        self.assertFalse(BENCHMARK.turn_is_idle(message))

    def test_idle_status_may_arrive_after_turn_complete_in_a_separate_message(self):
        completed_message = {"serverContent": {"turnComplete": True, "interactionStatus": "IN_PROGRESS"}}
        idle_message = {"serverContent": {"interactionStatus": "IDLE"}}
        self.assertFalse(BENCHMARK.turn_is_idle(completed_message))
        self.assertTrue(BENCHMARK.turn_is_idle(idle_message, turn_complete_seen=True))

    def test_idle_status_before_turn_complete_does_not_finish_a_turn(self):
        idle_message = {"serverContent": {"interactionStatus": "IDLE"}}
        self.assertFalse(BENCHMARK.response_generation_finished(idle_message))

if __name__ == "__main__":
    unittest.main()
