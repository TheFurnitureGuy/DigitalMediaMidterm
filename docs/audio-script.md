# Audio script: How color reduction works

For the audio player in the "Listen: how color reduction works" section.

Target length: about 4 minutes at a calm speaking pace (around 530 words).

The page shows this same text as the transcript. The only difference is that the page writes the hex code as #D6A860, and here it's D6A860 so you don't read the # sign aloud. If you change any words while recording, tell me so the transcript matches.

## Script

Your screen uses the RGB color model. It makes every color by mixing just three: red, green and blue. Each pixel has a tiny light for each one, and changing how bright they are gives you a different color. Turn all three all the way up and you get white. Turn them all off and you get black.

Your computer stores the brightness of each light as a number from 0 to 255. Each number takes 8 bits, so a pixel uses 24 bits in total. This is called 24-bit color, and it gives you about 16.7 million possible colors.

You've probably seen colors written as a code like D6A860. That's a hex code, and it's just those same three numbers written in a shorter way. The first two characters are the red, the middle two are the green, and the last two are the blue. So D6A860 means red 214, green 168 and blue 96, which is a light tan.

When a camera turns a real scene into a digital image, it does two things. First, it splits the scene into a grid of tiny squares called pixels. That step is sampling, and more pixels means more detail. Then comes quantization: each pixel's color gets rounded to the closest option from a fixed set. So sampling decides how much detail the image has, and quantization decides how many colors it can use.

Color quantization uses that same idea to cut an image down to just a few colors, while keeping it close to the original. Imagine drawing a sunset with only an 8-pack of crayons. You can't match every shade in the sky, so for each spot you pick the closest crayon you have. The computer does the same thing with every pixel.

Those few colors make up the palette. Instead of storing a full color for every pixel, the image keeps the palette once and gives each pixel a number that points to one of its colors. It works like a paint-by-numbers picture. An image saved this way is called an indexed image, and the palette acts as its lookup table. An 8-bit indexed image can have up to 256 colors, and it takes up much less space than a 24-bit one.

The downside is that smooth areas can lose their smoothness. A sky that slowly fades from light blue to dark blue needs lots of in-between shades. If the palette doesn't have enough of them, you see stripes of color instead of a smooth fade. Those stripes are called color banding.

Dithering makes an image with only a few colors look smoother. Its main job is to hide banding. To do that, it mixes the colors the image has in a fine pattern of dots. Up close you can see the dots, but from a normal distance your eye blends them into the shades in between. So the sky looks smooth again, even though no new colors were added.

Many PS2 games used this trick because they drew their graphics with fewer colors to save memory. They used a small checkered pattern. Old TVs had a soft picture that blurred the pattern away, so most players never noticed it.

## Recording checklist

- Export an uncompressed WAV first and keep it. The media table needs its file size.
- Write down the WAV's sample rate (for example, 44.1 kHz or 48 kHz) and bit depth (for example, 16-bit or 24-bit).
- Convert it to MP3 and write down the bitrate setting (for example, 128 kbps CBR or VBR quality 2), and whether it's mono or stereo.
- Put both files in `source-media/audio/`.
