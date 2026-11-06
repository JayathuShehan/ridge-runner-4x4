// AudioWorklet processor hosting the engine voice. Bundled to docs/engine-worklet.js.
import { EngineVoice } from './engineVoice.js';

class EngineProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.voice = new EngineVoice(options.processorOptions.config, sampleRate);
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'set') this.voice.set(m.p);
      else if (m.type === 'start') this.voice.start();
      else if (m.type === 'stop') this.voice.stop();
    };
  }
  process(inputs, outputs) {
    const ex = outputs[0], it = outputs[1];
    const n = ex[0].length;
    this.voice.process(ex[0], ex[1] || ex[0], it[0], n);
    return true;
  }
}
registerProcessor('engine-voice', EngineProcessor);
