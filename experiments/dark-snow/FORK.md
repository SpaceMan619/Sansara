# Dark Snow renderer fork

This directory is a Sansara fork of [Noniv/snowflow_demo](https://github.com/Noniv/snowflow_demo), captured from commit `545039733b74eec742862f161990142c7ca7c7ec` on 31 July 2026.

The upstream project is MIT licensed. Its `LICENSE` file is retained here unchanged. Sansara now launches the complete forked renderer, including the settings overlay, performance graph, atmosphere LUT, cascaded shadows, terrain deformation, post chain, character, wake, and spell systems. The next pass can adapt the surface language from snow toward sand without discarding the lighting architecture.

The original Sansara `?room=dune2` route remains the selector-compatible handoff while this WebGPU renderer is integrated. The selector presents it as **Dark Snow** so the experiment can develop its own identity without breaking existing links.
