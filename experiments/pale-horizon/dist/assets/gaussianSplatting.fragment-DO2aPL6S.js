import{t as e}from"./shaderStore-D-XQlhUT.js";import{n as t,t as n}from"./clipPlaneFragment-Ct2VqHzk.js";import{n as r,t as i}from"./fogFragment-EikOP4pH.js";import{t as a}from"./logDepthDeclaration-DYYUVTrx.js";import{t as o}from"./logDepthFragment-CxtJswLx.js";import{t as s}from"./packingFunctions-CINwVZs6.js";var c=`gaussianSplattingFragmentDeclaration`,l=`fn gaussianColor(inColor: vec4f,inPosition: vec2f)->vec4f
{var A : f32=-dot(inPosition,inPosition);if (A>-4.0)
{var B: f32=exp(A)*inColor.a;
#include<logDepthFragment>
var color: vec3f=inColor.rgb;
#ifdef FOG
#include<fogFragment>
#endif
return vec4f(color,B);} else {return vec4f(0.0);}}
`;e.IncludesShadersStoreWGSL[c]||(e.IncludesShadersStoreWGSL[c]=l);var u={name:c,shader:l},d=`gaussianSplattingPixelShader`,f=`#include<clipPlaneFragmentDeclaration>
#include<logDepthDeclaration>
#include<fogFragmentDeclaration>
#ifdef GPUPICKER_PACK_DEPTH
#include<packingFunctions>
#endif
varying vColor: vec4f;varying vPosition: vec2f;
#define CUSTOM_FRAGMENT_DEFINITIONS
#include<gaussianSplattingFragmentDeclaration>
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
var finalColor: vec4f=gaussianColor(input.vColor,input.vPosition);
#define CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR
#ifdef GPUPICKER_DEPTH
fragmentOutputs.fragData0=finalColor;
#ifdef GPUPICKER_PACK_DEPTH
fragmentOutputs.fragData1=pack(fragmentInputs.position.z);
#else
fragmentOutputs.fragData1=vec4f(fragmentInputs.position.z,0.0,0.0,1.0);
#endif
#else
fragmentOutputs.color=finalColor;
#endif
#define CUSTOM_FRAGMENT_MAIN_END
}
`;e.ShadersStoreWGSL[d]||(e.ShadersStoreWGSL[d]=f);var p=[t,a,r,s,o,i,u,n];for(let t of p)e.IncludesShadersStoreWGSL[t.name]||(e.IncludesShadersStoreWGSL[t.name]=t.shader);var m={name:d,shader:f};export{m as gaussianSplattingPixelShaderWGSL};