
class RecorderWorkletProcessor extends AudioWorkletProcessor {
  // 0. Determine the buffer size (this is the same as the 1st argument of ScriptProcessor)
  bufferSize = 4096;
  // 1. Track the current buffer fill level
  #bytesWritten = 0;
  // 2. Create a buffer of fixed size
  #buffer = new Float32Array(this.bufferSize);

  constructor() {
    super();
    this.initBuffer();
  }

  initBuffer() {
    this.#bytesWritten = 0;
  }

  isBufferEmpty() {
    return this.#bytesWritten === 0;
  }

  isBufferFull() {
    return this.#bytesWritten === this.bufferSize;
  }

  /**
   * @param {Float32Array[][]} inputs
   * @returns {boolean}
   */
  process(inputs, outputs) {
    // Grabbing the 1st channel similar to ScriptProcessorNode
    this.append(inputs[0][0]);

    const input = inputs[0];
    const output = outputs[0];
    for (let channel = 0; channel < input.length; ++channel) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];
      for (let i = 0; i < inputChannel.length; ++i) {
        outputChannel[i] = inputChannel[i];
      }
    }

    return true;
  }

  /**
   *
   * @param {Float32Array} channelData
   */
  append(channelData) {
    if (this.isBufferFull()) {
      this.flush();
    }

    if (!channelData) return;

    for (let i = 0; i < channelData.length; i++) {
      this.#buffer[this.#bytesWritten++] = channelData[i];
    }
  }

  flush() {
    // trim the buffer if ended prematurely
    this.port.postMessage(
      this.#bytesWritten < this.bufferSize ?
      this.#buffer.slice(0, this.#bytesWritten) :
      this.#buffer
    );
    this.initBuffer();
  }
}

registerProcessor("recorder-worklet", RecorderWorkletProcessor);
