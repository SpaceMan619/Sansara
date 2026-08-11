import{t as e}from"./shaderStore-D-XQlhUT.js";import{a as t,i as n,n as r,r as i,t as a}from"./bakedVertexAnimation-C6l_KSSy.js";import{n as o,t as s}from"./clipPlaneVertex-C59BO8JS.js";import{n as c,t as l}from"./fogVertex-NHlgMcT2.js";import{t as u}from"./instancesDeclaration-CJBvtBV5.js";import{t as d}from"./vertexColorMixing-DPW6Is9y.js";var f=`colorVertexShader`,p=`attribute vec3 position;
#ifdef VERTEXCOLOR
attribute vec4 color;
#endif
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<clipPlaneVertexDeclaration>
#include<fogVertexDeclaration>
#ifdef FOG
uniform mat4 view;
#endif
#include<instancesDeclaration>
uniform mat4 viewProjection;
#ifdef MULTIVIEW
uniform mat4 viewProjectionR;
#endif
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
varying vec4 vColor;
#endif
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
#ifdef VERTEXCOLOR
vec4 colorUpdated=color;
#endif
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vec4 worldPos=finalWorld*vec4(position,1.0);
#ifdef MULTIVIEW
if (gl_ViewID_OVR==0u) {gl_Position=viewProjection*worldPos;} else {gl_Position=viewProjectionR*worldPos;}
#else
gl_Position=viewProjection*worldPos;
#endif
#include<clipPlaneVertex>
#include<fogVertex>
#include<vertexColorMixing>
#define CUSTOM_VERTEX_MAIN_END
}`;e.ShadersStore[f]||(e.ShadersStore[f]=p);var m=[t,n,o,c,u,i,r,a,s,l,d];for(let t of m)e.IncludesShadersStore[t.name]||(e.IncludesShadersStore[t.name]=t.shader);var h={name:f,shader:p};export{h as colorVertexShader};