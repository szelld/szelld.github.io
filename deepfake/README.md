# Deepfake Audio Demo

This subsite is an interactive presentation demo for testing whether speech samples are real or AI-generated deepfakes.

## How to use your own audio files

1. Put your audio files into `deepfake/samples/`. Supported formats include `.flac`, `.wav`, `.mp3`, and `.ogg`.
2. Open `deepfake/index.html` and edit the `SAMPLES` array around line 430:

```javascript
const SAMPLES = [
  {
    id: 1,
    title: "Sample 1",
    file: "samples/real1.flac",      // your filename
    isDeepfake: false,               // false for Real, true for Deepfake
    clues: "Natural breathing pauses and pitch transitions."
  },
  {
    id: 2,
    title: "Sample 2",
    file: "samples/fake1.flac",
    isDeepfake: true,
    clues: "Synthesized speech artifacts and robotic sibilance."
  },
  // ... and so on for all 6 samples
];
```

## Presentation Keyboard Shortcuts
- `Space`: Play / Pause current audio
- `1` or `R`: Guess **Real Voice**
- `2` or `F`: Guess **Deepfake**
- `Enter` or `→`: Next Sample / Go to Results
- `←`: Previous Sample
