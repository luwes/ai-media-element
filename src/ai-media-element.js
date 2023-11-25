import { CustomVideoElement } from 'custom-media-element';
// import { MediaTracksMixin } from 'media-tracks';
import mp4box from 'mp4box';

const worker = new Worker(new URL('./transformer-worker.js', import.meta.url), {
  type: 'module',
});

const SAMPLING_RATE = 16000;
const DEFAULT_MODEL = 'Xenova/whisper-tiny';
const DEFAULT_SUBTASK = 'transcribe';
const DEFAULT_LANGUAGE = 'english';
const DEFAULT_QUANTIZED = true;
const DEFAULT_MULTILINGUAL = false;

const template = document.createElement('template');
template.innerHTML = /*html*/`
  <style>
    :host {
      position: relative;
    }
  </style>
`;

class AiVideoElement extends CustomVideoElement {
  #isInit = false;

  constructor() {
    super();
    this.shadowRoot.append(template.content.cloneNode(true));
  }

  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);

    switch (name) {
      case 'src':
        this.#init();
        break;
    }
  }

  async #init() {
    if (this.#isInit) return;
    this.#isInit = true;

    let mp4boxfile = mp4box.createFile();
    let initSegment;
    let offset = 0;

    mp4boxfile.onError = function(err) {
      console.log(err);
    };

    mp4boxfile.onReady = function(info) {
      console.log(info);

      mp4boxfile.setSegmentOptions(info.audioTracks[0].id, null, { nbSamples: 150 });
      initSegment = mp4boxfile.initializeSegmentation();
      console.log(initSegment);
      mp4boxfile.start();
    };

    mp4boxfile.onSegment = async (id, user, buffer, sampleNumber, last) => {
      let arrayBuffer = appendBuffer(
        initSegment[0].buffer,
        buffer,
      );

      let audioBuffer = await this.offlineCtx.decodeAudioData(arrayBuffer);
      const audioData = audioBuffer.getChannelData(0);

      await this.loadComplete;
      postAudio(audioData, offset);
      offset += audioBuffer.duration;
    };

    this.track = this.nativeEl.addTextTrack('captions', 'English', 'en');
    this.track.mode = 'showing';

    worker.addEventListener('message', this);

    this.loadComplete = new PublicPromise();

    this.addEventListener('loadedmetadata', async () => {
      this.offlineCtx = new OfflineAudioContext(1, this.duration * SAMPLING_RATE, SAMPLING_RATE);

      const response = await fetch(`${this.src}`);
      const reader = response.body.getReader();

      let fileStart = 0;

      while (true) { // eslint-disable-line no-constant-condition
        const { done, value } = await reader.read();

        if (done) {
          console.log('done');
          return;
        }

        try {
          value.buffer.fileStart = fileStart;
          mp4boxfile.appendBuffer(value.buffer);
          fileStart += value.buffer.byteLength;
        } catch (err) {
          console.log(err);
        }
      }
    });

    // const transcribedMedia = this.nativeEl.cloneNode();
    // transcribedMedia.playbackRate = 2;
    // transcribedMedia.controls = true;
    // transcribedMedia.muted = false;
    // Object.assign(transcribedMedia.style, {
    //   // display: 'none', // comment out to see the video used for transcription
    //   position: 'absolute',
    //   width: '150px',
    // });
    // this.append(transcribedMedia);

    // const audioContext = new AudioContext({ sampleRate: SAMPLING_RATE });
    // const source = audioContext.createMediaElementSource(transcribedMedia);

    // await audioContext.audioWorklet.addModule(new URL('./recorder-worklet.js', import.meta.url));

    // const recorderNode = new AudioWorkletNode(audioContext, 'recorder-worklet');
    // source
    //   .connect(recorderNode)
    //   .connect(audioContext.destination);

    let recording = false;
    let audioSegments = [];
    postAudio(audioSegments);

    // transcribedMedia.addEventListener('playing', () => {
    //   recording = true;
    // });

    // transcribedMedia.addEventListener('pause', () => {
    //   recording = false;
    // });

    // transcribedMedia.addEventListener('seeking', () => {
    //   recording = false;
    // });

    // transcribedMedia.addEventListener('seeked', () => {
    //   audioSegments = [];
    //   offset = transcribedMedia.currentTime;
    // });

    this.addEventListener('play', async () => {
      // await audioContext.resume();
      // transcribedMedia.play();
      console.log('play');
      audioSegments = [];
    });

    this.addEventListener('pause', () => {
      // transcribedMedia.pause();
      console.log('pause');
      // const audio = concatenateFloat32Arrays(audioSegments);
      // postAudio(audio);
      audioSegments = [];
    });

    this.addEventListener('seeking', () => {
      // transcribedMedia.currentTime = this.currentTime;
    });

    // recorderNode.port.onmessage = (e) => {
    //   if (recording) {
    //     // todo: figure out a better way to create audio segments
    //     // we build up longer segments because whisper improves
    //     // the transcript based on neighboring audio.

    //     // const lastCueText = [...this.track.cues].pop()?.text;
    //     // console.log('endsWith', lastCueText?.endsWith('.'));

    //     if (audioSegments.length > 5) {
    //       offset += getAudioDuration(concatenateFloat32Arrays(audioSegments));
    //       audioSegments = [];
    //     }

    //     audioSegments.push(e.data);
    //     const audio = concatenateFloat32Arrays(audioSegments);
    //     console.log(`transcribing a ${getAudioDuration(audio)}s audio segment`);
    //     postAudio(audio, offset);
    //   }
    // };
  }

  handleEvent(event) {
    super.handleEvent(event);

    if (event.data?.status === 'done') {
      this.loadComplete.resolve();
    }

    switch (event.type) {
      case 'message':
        return this.#handleMessage(event);
    }
  }

  #handleMessage(event) {
    const { data } = event;

    if (data.status === 'update') {
      const offset = data.offset ?? 0;
      const chunks = data.data[1].chunks;

      for (let chunk of chunks) {
        console.log(
          'transcribed chunk',
          chunk.timestamp[0],
          '->',
          chunk.timestamp[1],
          chunk.text
        );

        const [start, end = 2] = chunk.timestamp;

        const startTime = (offset + start);
        const endTime = (offset + end);

        // todo: figure out a way to better handle overlapping cues
        [...this.track.cues]
          .filter(cue => cue.startTime >= startTime - .2 && cue.startTime <= endTime + .2)
          .forEach(cue => {
            this.track.removeCue(cue);
          });

        const cue = new VTTCue(startTime, endTime, chunk.text);
        this.track.addCue(cue);
      }
    }
  }
}

function getAudioDuration(arrayBuffer, numChannels = 1, sampleRate = SAMPLING_RATE, isFloatingPoint = true) {
  // PCM 16 or Float32
  const bytesPerSample = (isFloatingPoint ? Float32Array : Uint16Array).BYTES_PER_ELEMENT;
  // total samples/frames
  const totalSamples = arrayBuffer.byteLength / bytesPerSample / numChannels;
  // total seconds
  return totalSamples / sampleRate;
}

function concatenateFloat32Arrays(chunks) {
  const length = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Float32Array(length);
  let offset = 0;
  for (let chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function postAudio(audio, offset) {
  if (audio) {
    const model = DEFAULT_MODEL;
    const multilingual = DEFAULT_MULTILINGUAL;
    const subtask = DEFAULT_SUBTASK;
    const language = DEFAULT_LANGUAGE;

    worker.postMessage({
      offset,
      audio,
      model,
      multilingual,
      quantized: DEFAULT_QUANTIZED,
      subtask: multilingual ? subtask : null,
      language: multilingual && language !== "auto" ? language : null,
    });
  }
}

/**
 * A utility to create Promises with convenient public resolve and reject methods.
 * @return {Promise}
 */
class PublicPromise extends Promise {
  constructor(executor = () => {}) {
    let res, rej;
    super((resolve, reject) => {
      executor(resolve, reject);
      res = resolve;
      rej = reject;
    });
    this.resolve = res;
    this.reject = rej;
  }
}

function appendBuffer(buffer1, buffer2) {
  var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(new Uint8Array(buffer1), 0);
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
  return tmp.buffer;
}

if (globalThis.customElements && !globalThis.customElements.get('ai-video')) {
  globalThis.customElements.define('ai-video', AiVideoElement);
}
