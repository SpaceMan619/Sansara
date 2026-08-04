// Linear-depth prepass for the imported glTF character. The mesh uses CPU
// skinning (only ~5.5k vertices), so `position` already contains the current
// animated pose and this pass cannot diverge from the beauty geometry.

attribute position: vec3f;

uniform world: mat4x4f;
uniform viewProjection: mat4x4f;

varying vViewZ: f32;
varying vMask: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let worldPos = uniforms.world * vec4f(vertexInputs.position, 1.0);
    let clip = uniforms.viewProjection * worldPos;
    vertexOutputs.vViewZ = clip.w;
    vertexOutputs.vMask = 0.0;
    vertexOutputs.position = clip;
}
