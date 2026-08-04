// Shadow-cascade vertex shader for the imported Kenney SUV.
//
// A rigid caster: unlike the terrain (which must replay its clipmap displacement
// so its shadow matches its beauty geometry) the car only needs its per-draw
// world matrix — auto-bound by Babylon — times the cascade's light matrix, which
// ShadowSystem.update writes into `lightViewProjection` per cascade. The
// `terrainDepth` fragment stage is reused to write NDC depth into the R32F atlas.
//
// A parked SUV with no contact shadow is the single loudest "floating object"
// cue on an otherwise grounded snow field; this is what removes it.

attribute position: vec3f;

uniform world: mat4x4f;
uniform lightViewProjection: mat4x4f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    vertexOutputs.position = uniforms.lightViewProjection * uniforms.world
        * vec4f(vertexInputs.position, 1.0);
}
