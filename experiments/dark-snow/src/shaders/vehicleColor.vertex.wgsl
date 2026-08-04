// Beauty pass for the imported Kenney SUV.
//
// A rigid glTF: no skinning, so `world` (auto-bound per draw by Babylon) is the
// whole transform. UVs address the shared `colormap.png` atlas; the world normal
// is carried so the fragment stage can give the flat-shaded body some form under
// Dark Snow's sun rather than reading as a pasted-on decal.

attribute position: vec3f;
attribute normal: vec3f;
attribute uv: vec2f;

uniform world: mat4x4f;
uniform viewProjection: mat4x4f;

varying vNormal: vec3f;
varying vUV: vec2f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let worldPos = uniforms.world * vec4f(vertexInputs.position, 1.0);
    // The vehicle is scaled uniformly (root.scaling.setAll), so the world 3x3 is
    // a rotation times a scalar and the normal survives it after renormalising.
    vertexOutputs.vNormal = normalize((uniforms.world * vec4f(vertexInputs.normal, 0.0)).xyz);
    vertexOutputs.vUV = vertexInputs.uv;
    vertexOutputs.position = uniforms.viewProjection * worldPos;
}
