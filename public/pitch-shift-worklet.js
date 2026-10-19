/*
 * AskMoina high-register live playback processor.
 *
 * Two crossfaded delay taps shift the outgoing voice upward while preserving
 * its duration. The processor touches assistant playback only; microphone
 * capture never passes through this node.
 */
class AskMoinaYouthfulPitchShifter extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    const requestedSemitones = Number(options.processorOptions?.pitchSemitones ?? 6);
    this.semitones = Number.isFinite(requestedSemitones)
      ? Math.max(0, Math.min(12, requestedSemitones))
      : 6;
    this.ratio = Math.pow(2, this.semitones / 12);
    this.span = Math.max(1024, Math.round(sampleRate * 0.08));
    this.minDelay = Math.max(96, Math.round(sampleRate * 0.012));
    let bufferLength = 1;
    while (bufferLength <= this.minDelay + this.span + 2) bufferLength *= 2;
    this.ring = new Float32Array(bufferLength);
    this.writeIndex = 0;
    this.phase = 0;

    this.port.onmessage = (event) => {
      if (event.data?.type === "reset") {
        this.ring.fill(0);
        this.writeIndex = 0;
        this.phase = 0;
      }
    };
  }

  readDelayed(delay) {
    const length = this.ring.length;
    let position = this.writeIndex - delay;
    position %= length;
    if (position < 0) position += length;
    const lower = Math.floor(position);
    const upper = (lower + 1) % length;
    const fraction = position - lower;
    return this.ring[lower] * (1 - fraction) + this.ring[upper] * fraction;
  }

  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;

    const input = inputs[0]?.[0];
    const phaseStep = (1 - this.ratio) / this.span;

    for (let i = 0; i < output.length; i += 1) {
      this.ring[this.writeIndex] = input ? (input[i] || 0) : 0;

      const phaseA = this.phase;
      const phaseB = phaseA >= 0.5 ? phaseA - 0.5 : phaseA + 0.5;
      const delayA = this.minDelay + phaseA * this.span;
      const delayB = this.minDelay + phaseB * this.span;
      const sineA = Math.sin(Math.PI * phaseA);
      const sineB = Math.sin(Math.PI * phaseB);
      const weightA = sineA * sineA;
      const weightB = sineB * sineB;

      output[i] =
        this.readDelayed(delayA) * weightA +
        this.readDelayed(delayB) * weightB;

      this.phase += phaseStep;
      this.phase %= 1;
      if (this.phase < 0) this.phase += 1;
      this.writeIndex = (this.writeIndex + 1) % this.ring.length;
    }

    return true;
  }
}

registerProcessor("askmoina-youthful-pitch-shifter", AskMoinaYouthfulPitchShifter);
