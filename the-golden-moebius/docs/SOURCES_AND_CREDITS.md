# Sources and credits

Verified for this edition on 24 October 2026. Homepage text is newly written and paraphrased; no paper figures, excerpts or original video-game artwork were copied into the site.

## Opening photograph

**Photographer:** Bob Wick, Bureau of Land Management (published through `mypubliclands`).

**Work:** “#mypubliclandsroadtrip 2016: On The Way To, Alabama Hills”, photograph taken 30 July 2016.

- Description and license record: https://commons.wikimedia.org/wiki/File:-mypubliclandsroadtrip_2016-_On_The_Way_To,_Alabama_Hills_(28031000793).jpg
- Original publication: https://www.flickr.com/photos/mypubliclands/28031000793
- Original image: https://upload.wikimedia.org/wikipedia/commons/2/26/-mypubliclandsroadtrip_2016-_On_The_Way_To%2C_Alabama_Hills_%2828031000793%29.jpg
- Wikimedia identifies it as a work made by a BLM employee in official duties, public domain in the United States; it also records a CC BY 2.0 distribution: https://creativecommons.org/licenses/by/2.0/

The site credits Bob Wick / BLM, links the source and license, and identifies resizing, WebP conversion, layout cropping and gradient shading. The local `mobius-arch-*.webp` and social JPEG derive from that image. No endorsement by the photographer or BLM is claimed. Captions identify the Mount Whitney **massif**, without attaching an inaccurate label to an individual nearby summit.

## Science

1. Jennings, C. V. et al. (2005). *Isolation, solution structure, and insecticidal activity of kalata B2, a circular protein with a twist: do Möbius strips exist in nature?* Biochemistry 44, 851–860. DOI: https://doi.org/10.1021/bi047837h ; abstract: https://pubmed.ncbi.nlm.nih.gov/15654741/
   - Supports naturally occurring plant cyclotides and the conceptual molecular Möbius comparison. The site does not call the peptide a literal two-dimensional sheet.
2. Tanda, S. et al. (2002). *A Möbius strip of single crystals.* Nature 417, 397–398. https://doi.org/10.1038/417397a
   - Supports actual NbSe₃ crystal ribbons, formed under laboratory conditions.
3. Bauer, T. et al. (2015). *Observation of optical polarization Möbius strips.* Science 347, 964–966. https://doi.org/10.1126/science.1260635 ; abstract: https://pubmed.ncbi.nlm.nih.gov/25636796/
   - Supports polarization topology in specially prepared light fields, not solid light ribbons.
4. Ajami, D. et al. (2003). *Synthesis of a Möbius aromatic hydrocarbon.* Nature 426, 819–821. https://doi.org/10.1038/nature02224
   - Supports synthesized molecular conjugated systems with Möbius topology.
5. Han, D. et al. (2010). *Folding and cutting DNA into reconfigurable topological nanostructures.* Nature Nanotechnology 5, 712–717. https://doi.org/10.1038/nnano.2010.193
   - Supports designed DNA origami Möbius ribbons. It does not establish that ordinary DNA supercoiling makes a Möbius surface.

The basic half-twist, one-surface, one-boundary explanation and the identification `(0,v) ≡ (2π,−v)` are standard mathematical definitions. The homepage's illustration uses the same parametrization as the 3D viewer, with a single boundary traced over `0 ≤ u ≤ 4π`.

## Place and history

- Bureau of Land Management, Alabama Hills: https://www.blm.gov/visit/alabama-hills
- Bureau of Land Management, Mobius Arch Loop Trail: https://www.blm.gov/visit/mobius-arch-loop-trail
- National Park Service, The California Gold Rush: https://www.nps.gov/cali/learn/historyculture/california-gold-rush.htm
- California State Parks, Gold Rush Overview: https://www.parks.ca.gov/?page_id=1081
- California State Parks, History Programs handbook (statehood): https://www.parks.ca.gov/pages/735/files/08JRHandbk-History%20ADA%20passed.pdf
- PBS American Experience, The Gold Rush, documentary transcript (human and environmental impacts): https://www.pbs.org/wgbh/americanexperience/films/goldrush/

The site separates the Alabama Hills on the eastern side of the Sierra Nevada from Sutter's Mill near Coloma in the western foothills. The arch is not presented as a Gold Rush discovery site. The comic game route is not presented as a geographical reconstruction or a particular family's historical journey.

## Software and game assets

- Three.js 0.186.1, MIT: https://github.com/mrdoob/three.js ; local license at `dist/assets/vendor/three/LICENSE.txt`.
- Press Start 2P by CodeMan38, SIL Open Font License: https://github.com/google/fonts/tree/main/ofl/pressstart2p ; local license at `dist/assets/press-start-OFL.txt`.
- Tailwind CSS 3.4.17, MIT, used at build time for the existing Gold Rush utility classes. The build tool's license is in its package/repository: https://github.com/tailwindlabs/tailwindcss/tree/v3.4.17 . The distributed generated stylesheet retains its license banner; the full local license is `dist/assets/vendor/tailwind-LICENSE.txt`. The browser does not load the Tailwind CDN runtime.
- Gold Rush Trail source: the user's supplied game, including the repaired events and restart state from this conversation. Its descriptions and medical hazards are comic fiction. A captured game screen supplies the local preview image.
- Möbius viewer source: the user's supplied viewer and the liquid-gold shader edit from this conversation. The still fallback is a software rendering of that shader and geometry.
- West Bank: Frontier Edition: the newly created browser implementation from this conversation. Its code, graphics and synthesized audio were made for this edition. The historical Dinamic Software name/game is credited; no original ROM, sprite extraction or soundtrack is included. Its local preview is a captured screen from this implementation.

Third-party licenses and historical game branding remain associated with their respective creators. This project does not claim an official relationship with Dinamic, BLM or the cited researchers.
