# Deepfake Audio Demo

This subsite is an interactive presentation demo for testing whether speech samples are real or AI-generated deepfakes.

It has two quizzes, switchable with the tabs at the top, each with its own results page:

- **Training set** (`samples/train/`): attacks A01–A06 from ASVspoof 2019 LA, the methods the model was trained on.
- **Evaluation set** (`samples/eval/`): attacks A07–A19, methods the model never saw during training.

The results page shows which attack generated each fake and how it works; for the evaluation set it also shows the model's detection rate for that attack.

## How to use your own audio files

1. Put your audio files into `deepfake/samples/train/` or `deepfake/samples/eval/`. Supported formats include `.flac`, `.wav`, `.mp3`, and `.ogg`.
2. Open `deepfake/index.html` and edit the `samples` array of the matching entry in `SETS`:

```javascript
const SETS = {
  train: {
    name: "Training set",
    note: "Shown under the results table.",
    samples: [
      {
        title: "Sample 1",
        file: "samples/train/real1.flac", // your filename
        isDeepfake: false,                // false for Real, true for Deepfake
        clues: "Natural breathing pauses and pitch transitions.",
        technique: "Bona fide human recording."
      },
      {
        title: "Sample 2",
        file: "samples/train/fake1.flac",
        isDeepfake: true,
        clues: "Synthesized speech artifacts and robotic sibilance.",
        attack: "A02",                    // shown on the results page
        technique: "Text-to-speech with the WORLD vocoder.",
        detectRate: "99.9%"               // optional
      },
      // ...
    ]
  },
  eval: { /* same shape */ }
};
```

## Presentation Keyboard Shortcuts
- `Space`: Play / Pause current audio
- `1` or `R`: Guess **Real Voice**
- `2` or `F`: Guess **Deepfake**
- `Enter` or `→`: Next Sample / Go to Results
- `←`: Previous Sample
- `T` / `E`: Switch to the Training / Evaluation set
