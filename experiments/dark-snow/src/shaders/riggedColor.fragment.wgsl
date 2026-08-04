// Preserve the authored colour atlas exactly. Atmosphere and tone mapping are
// still applied by Dark Snow's camera post chain after this pass.

varying vColor: vec4f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    // Dark Snow's authored surfaces emit HDR radiance and the camera exposure
    // is correspondingly low. Lift this ordinary 0..1 atlas into that same
    // pre-tonemap range so it does not collapse into a silhouette.
    fragmentOutputs.color = vec4f(input.vColor.rgb * 4.0, input.vColor.a);
}
