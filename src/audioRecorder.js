export class AudioRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.stream = null;
    this.audioChunks = []; // Active chunk segments
    this.allRecordedChunks = []; // Array of finished chunk Blobs (each max 50 mins)
    this.state = 'inactive'; // 'inactive', 'recording', 'paused'
    
    // Web Audio API properties for visualization
    this.audioContext = null;
    this.analyser = null;
    this.sourceNode = null;
    
    // Configuration
    this.chunkDuration = 50 * 60 * 1000; // 50 minutes per audio chunk in ms
    this.chunkTimer = null;
    this.onChunkFinished = null; // Callback when a chunk is completed
    this.onProgress = null; // Callback for elapsed time updates
    
    this.startTime = 0;
    this.elapsedTime = 0;
    this.timerInterval = null;
  }

  // Get preferred MIME type supported by browser
  static getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/aac'
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  }

  async start() {
    if (this.state !== 'inactive') return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      this.allRecordedChunks = [];
      this.elapsedTime = 0;
      this.state = 'recording';
      this.startTime = Date.now();

      this._setupAudioContext();
      this._startRecorderSession();
      this._startTimer();

      console.log('Recording started with MIME type:', AudioRecorder.getSupportedMimeType());
    } catch (err) {
      console.error('Failed to start recording:', err);
      this.state = 'inactive';
      throw err;
    }
  }

  _startRecorderSession() {
    const mimeType = AudioRecorder.getSupportedMimeType();
    const options = mimeType ? { mimeType } : {};
    
    this.mediaRecorder = new MediaRecorder(this.stream, options);
    this.audioChunks = [];

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      const mime = AudioRecorder.getSupportedMimeType() || 'audio/webm';
      const chunkBlob = new Blob(this.audioChunks, { type: mime });
      this.allRecordedChunks.push(chunkBlob);
      
      if (this.onChunkFinished) {
        this.onChunkFinished(chunkBlob, this.allRecordedChunks.length - 1);
      }

      // If we stopped because of chunk limit and are still in recording state, start the next one
      if (this.state === 'recording') {
        this._startRecorderSession();
      }
    };

    // Start recording, request data every 1 second
    this.mediaRecorder.start(1000);

    // Setup timer to split chunks every 50 minutes (to avoid exceeding Gemini free tier 1M tokens/min)
    if (this.chunkTimer) clearTimeout(this.chunkTimer);
    this.chunkTimer = setTimeout(() => {
      if (this.state === 'recording') {
        console.log('Reached 50 minutes. Slicing audio into a new chunk for Gemini compliance.');
        this._rotateChunk();
      }
    }, this.chunkDuration);
  }

  _rotateChunk() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      // Stopping will trigger onstop which pushes the current chunk and starts a new session if state === 'recording'
      this.mediaRecorder.stop();
    }
  }

  _setupAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.sourceNode.connect(this.analyser);
    } catch (err) {
      console.warn('Audio Context visualization setup failed:', err);
    }
  }

  pause() {
    if (this.state !== 'recording') return;
    
    this.state = 'paused';
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
    }
    
    if (this.chunkTimer) clearTimeout(this.chunkTimer);
    clearInterval(this.timerInterval);
    
    // Suspend audio context to save power
    if (this.audioContext && this.audioContext.state === 'running') {
      this.audioContext.suspend();
    }
  }

  resume() {
    if (this.state !== 'paused') return;

    this.state = 'recording';
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
    }

    this._startTimer();
    
    // Resume audio context
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    // Set remaining duration for chunk rotation
    if (this.chunkTimer) clearTimeout(this.chunkTimer);
    const elapsedInCurrentChunk = this.elapsedTime % (this.chunkDuration / 1000);
    const remainingTime = this.chunkDuration - (elapsedInCurrentChunk * 1000);
    this.chunkTimer = setTimeout(() => {
      if (this.state === 'recording') {
        this._rotateChunk();
      }
    }, remainingTime);
  }

  async stop() {
    if (this.state === 'inactive') return null;

    const previousState = this.state;
    this.state = 'inactive';
    
    if (this.chunkTimer) clearTimeout(this.chunkTimer);
    clearInterval(this.timerInterval);

    // Stop media recorder
    const stopPromise = new Promise((resolve) => {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.onstop = () => {
          const mime = AudioRecorder.getSupportedMimeType() || 'audio/webm';
          const chunkBlob = new Blob(this.audioChunks, { type: mime });
          this.allRecordedChunks.push(chunkBlob);
          
          if (this.onChunkFinished) {
            this.onChunkFinished(chunkBlob, this.allRecordedChunks.length - 1);
          }
          resolve(this.allRecordedChunks);
        };
        this.mediaRecorder.stop();
      } else {
        resolve(this.allRecordedChunks);
      }
    });

    const chunks = await stopPromise;

    // Stop all media tracks
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
    }

    // Close audio context
    if (this.audioContext) {
      await this.audioContext.close();
    }

    return {
      chunks: chunks,
      duration: this.elapsedTime,
      mimeType: AudioRecorder.getSupportedMimeType() || 'audio/webm'
    };
  }

  _startTimer() {
    this.timerInterval = setInterval(() => {
      this.elapsedTime += 1;
      if (this.onProgress) {
        this.onProgress(this.elapsedTime);
      }
    }, 1000);
  }

  getAnalyserData() {
    if (!this.analyser) return null;
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }
}
