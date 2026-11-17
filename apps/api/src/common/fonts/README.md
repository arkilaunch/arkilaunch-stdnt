# PDF fonts

The API bundles regular/bold fonts so rendering does not depend on the host OS or tenant browser. Full font embedding avoids missing glyphs seen when subsetting Inter; each render owns its own font instances.

- `inter-regular.ttf`, `inter-bold.ttf`: static 400/700 instances of the Google Fonts Inter variable release, default optical size. Source: https://github.com/google/fonts/tree/main/ofl/inter . License: `inter-OFL.txt`.
- `plex-regular.ttf`, `plex-bold.ttf`: unmodified IBM Plex Sans static TrueType fonts, renamed on disk only. Source: https://github.com/IBM/plex/tree/master/packages/plex-sans/fonts/complete/ttf . License: `plex-OFL.txt`.

Nest copies this directory to `dist/common/fonts`. Missing tenant font settings select Inter; business data is never used as a font path.
