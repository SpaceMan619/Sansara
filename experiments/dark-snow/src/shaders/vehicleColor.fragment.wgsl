// Beauty pass for the imported Kenney SUV — fragment stage.
//
// Dark Snow declares "no stock lights: every material computes its own
// lighting", and its authored surfaces emit HDR radiance the camera exposure is
// tuned low for. So this does two things the old Babylon StandardMaterial could
// not do in-world: it lights the car with the *same* sun direction the sky
// solves each frame, and it emits in the same pre-tonemap HDR range as the snow
// (rather than a 0..1 sRGB result that collapsed to a flat charcoal silhouette
// under the shared post chain). The hemispheric fill and warm sun below are the
// same values the removed StandardMaterial lights carried, so the tuned look is
// preserved while the car finally sits inside the atmosphere.

uniform sunDir: vec3f;

var carTex: texture_2d<f32>;
var carTexSampler: sampler;

varying vNormal: vec3f;
varying vUV: vec2f;

// Ported verbatim from the deleted HemisphericLight / DirectionalLight pair.
const SKY_FILL   = vec3f(0.72, 0.80, 1.00) * 1.15;
const GROUND_FILL = vec3f(0.12, 0.16, 0.23) * 1.15;
const SUN_COLOR  = vec3f(1.00, 0.71, 0.40) * 2.60;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let albedo = textureSample(carTex, carTexSampler, input.vUV).rgb;
    let n = normalize(input.vNormal);

    // Hemispheric ambient: sky above, cooler bounce below, blended by the
    // vertical component of the surface normal.
    let hemi = mix(GROUND_FILL, SKY_FILL, clamp(0.5 + 0.5 * n.y, 0.0, 1.0));
    let ndl = max(dot(n, normalize(uniforms.sunDir)), 0.0);

    let lit = albedo * (hemi + SUN_COLOR * ndl);
    fragmentOutputs.color = vec4f(lit, 1.0);
}
