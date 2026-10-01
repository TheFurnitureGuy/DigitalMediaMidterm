# Audio script: How color reduction works

For the audio player in the "Listen: how color reduction works" section.

Target length: about 50 seconds at a calm speaking pace (around 130 words).

The page shows this same text as the transcript. If you change any words while recording, tell me so the transcript matches.

## Script

Every color on your screen is a mix of red, green and blue. Each one has a value from 0 to 255, so a single pixel can be one of about 16 million colors.

Quantization reduces that number. The image gets a small set of colors, called a palette, and each pixel is replaced with the closest color in it. So several similar blues might all become one blue.

With fewer colors, smooth areas like the sky start to show bands. Dithering helps with this. It places different palette colors next to each other in a pattern, and from a distance your eye blends them into a shade the palette doesn't have.

Keep in mind that this changes the colors, not the size. Resolution sets how many pixels there are, and polygon detail sets how many triangles draw the photo.

## Recording checklist

- Export an uncompressed WAV first and keep it. The media table needs its file size.
- Write down the WAV's sample rate (for example, 44.1 kHz or 48 kHz) and bit depth (for example, 16-bit or 24-bit).
- Convert it to MP3 and write down the bitrate setting (for example, 128 kbps CBR or VBR quality 2), and whether it's mono or stereo.
- Put both files in `source-media/audio/`.
