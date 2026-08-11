# Aircraft assets

Each ingested aircraft gets its own directory. `manifest.json` and `source/provenance.json` are small reviewable records; official downloads and generated GLBs stay ignored until someone reviews their licensing and distribution terms.

Runtime tiers always use these paths:

- `runtime/high/model.glb` with a 2048 px texture ceiling
- `runtime/balanced/model.glb` with a 1024 px texture ceiling
- `runtime/low/model.glb` with a 512 px texture ceiling

Run the tooling from `tools/aircraft-pipeline`; its README covers ingestion and validation.
