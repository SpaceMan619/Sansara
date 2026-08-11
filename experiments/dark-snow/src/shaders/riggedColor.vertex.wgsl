// Beauty pass for the imported CPU-skinned character.

attribute position: vec3f;
attribute color: vec4f;

uniform world: mat4x4f;
uniform viewProjection: mat4x4f;

varying vColor: vec4f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    vertexOutputs.vColor = vertexInputs.color;
    vertexOutputs.position = uniforms.viewProjection * uniforms.world *
        vec4f(vertexInputs.position, 1.0);
}
