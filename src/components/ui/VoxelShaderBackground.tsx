'use client';

import React, { useRef, useEffect } from 'react';

const VOXEL_FRAGMENT_SHADER = `
#ifdef GL_ES
precision mediump float;
#endif

uniform float u_time;
uniform vec2 u_resolution;

#define iTime u_time
#define iResolution u_resolution

#define PI 3.141592653589793
#define PIdiv2 1.57079632679489
#define TwoPI 6.283185307179586
#define INFINI 1000000.

#define NO_TRANSPARENCY
#define BORDER

#define boxDim 100.
#define maxBoxRnge 70
#define emptyChance 30.

#define GND -1
#define SKY -1000
#define NONE 0
#define BOX 1

vec3 color = vec3(0.);
vec3 lightRay = normalize(vec3(1.,.4,.2));

float H1 (in float v) {
    return fract(sin(v) * 437585.);
}
float H2 (in vec2 st,in float time) {
    return fract(sin(dot(st,vec2(12.9898,8.233))) * 43758.5453123+time);
}
float H3 (in vec3 st,in float time) {
    return fract(sin(dot(st,vec3(12.9898,8.233,17.6533107))) * 43758.5453123+time);
}

vec3 skyGlow(in vec3 ray){
    float a = dot(lightRay, ray);
    return vec3(max(0.,sign(a)*pow(a,9.)));
}

vec3 setBox(in vec3 p){
    return floor(p/boxDim + .5);
}

vec3 deBox(in vec3 box){
    return box*boxDim;
}

vec3 getNextBox(in vec3 p, in vec3 v, in vec3 box){
    vec3 d = sign(v);
    vec3 dt = ((box+d*.5)*boxDim-p)/v;
    float dmin = min(min(dt.x,dt.y),dt.z);
    d *= step(dt, vec3(dmin));
    return box+d;
}

bool checkBox(in vec3 box){
    float h = H3(floor(box),0.)*(emptyChance + 2.);
    return bool(int(floor( max(0.,h-emptyChance) )));
}

void browseBox(in vec3 box, in vec3 pos, in vec3 ray, inout int hitObj){
    float t = INFINI;
    float hitNbr = 0.;
    for(int i=0; i<maxBoxRnge;i++){
        vec3 newBox = getNextBox(pos,ray,box);
        vec3 d = newBox - box;

        if(checkBox(newBox)) {
            hitNbr ++;
            color += 1./hitNbr*((dot(-d,lightRay)+1.)*.3+.4)*vec3(.08,H3(newBox,0.)/5.,0.3);

            #ifdef BORDER
            vec3 o = deBox(newBox-.5*d);
            if(d.x != 0.){
                t = (o.x-pos.x)/ray.x;
                vec3 p = pos+t*ray;
                color += .1*(smoothstep(.4*boxDim, .5*boxDim ,abs(o.y-p.y)) + smoothstep(.4*boxDim, .5*boxDim ,abs(o.z-p.z)));
            }
            else if(d.y != 0.){
                t = (o.y-pos.y)/ray.y;
                vec3 p = pos+t*ray;
                color += .1*(smoothstep(.4*boxDim, .5*boxDim ,abs(o.x-p.x)) + smoothstep(.4*boxDim, .5*boxDim ,abs(o.z-p.z)));
            }
            else if(d.z != 0.){
                t = (o.z-pos.z)/ray.z;
                vec3 p = pos+t*ray;
                color += .1*(smoothstep(.4*boxDim, .5*boxDim ,abs(o.x-p.x)) + smoothstep(.4*boxDim, .5*boxDim ,abs(o.y-p.y)));
            }
            #endif

            vec3 refl = reflect(ray,d);
            color += .9*skyGlow(refl);

            #ifdef NO_TRANSPARENCY
            if(bool(mod(newBox.y, 2.))){
                hitObj = BOX;
                break;
            }
            #endif
        }
        box = newBox;
    }
    color = clamp(color,0.,1.);
}

vec3 getCamPos(in vec3 camTarget){
    float 	rau = 1300.*(sin(iTime/7.)+1.) + 50.,
            alpha = 0.5 * 4.0 * PI,
            theta = -0.15;

    return rau*vec3(-cos(theta)*sin(alpha),sin(theta),cos(theta)*cos(alpha));
}

vec3 getRay(in vec2 st, in vec3 pos, in vec3 camTarget){
    float 	focal = 1.;
    vec3 ww = normalize( camTarget - pos );
    vec3 uu = normalize( cross(ww,vec3(0.0,1.0,0.0)) ) ;
    vec3 vv = cross(uu,ww);
    return normalize( st.x*uu + st.y*vv + focal*ww );
}

void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
    vec2 st = fragCoord.xy/iResolution.xy-.5;
    st.x *= iResolution.x/iResolution.y;

    vec3 camTarget = vec3(0.);
    vec3 pos = getCamPos(camTarget);
    vec3 ray = getRay(st, pos,camTarget);

    vec3 lightRay = vec3(1.,0.,0.);

    float t = INFINI;
    int hitObj = SKY;
    vec3 p = pos;

    vec3 box = setBox(p);

    browseBox(box, pos, ray, hitObj);

    if(hitObj == SKY) color += skyGlow(ray);

    fragColor = vec4(color,1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

export default function VoxelShaderBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sandboxRef = useRef<InstanceType<(typeof import('glslCanvas'))['default']> | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let destroyed = false;
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

    const setCanvasSize = () => {
      if (!canvasRef.current || destroyed) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvasRef.current.width = Math.floor(w * dpr);
      canvasRef.current.height = Math.floor(h * dpr);
      sandboxRef.current?.resize();
    };

    const initGLSL = async () => {
      try {
        setCanvasSize();
        const GlslCanvas = (await import('glslCanvas')).default;
        if (destroyed || !canvasRef.current) return;
        const sandbox = new GlslCanvas(canvas, {
          fragmentString: VOXEL_FRAGMENT_SHADER,
        });
        if (destroyed) {
          sandbox.destroy();
          return;
        }
        sandboxRef.current = sandbox;
        setCanvasSize();
        window.addEventListener('resize', setCanvasSize);
      } catch (error) {
        console.error('Failed to load voxel shader:', error);
      }
    };

    initGLSL();

    return () => {
      destroyed = true;
      window.removeEventListener('resize', setCanvasSize);
      if (sandboxRef.current) {
        sandboxRef.current.destroy();
        sandboxRef.current = null;
      }
    };
  }, []);

  return (
    <div
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden
    >
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        style={{ opacity: 0.85 }}
      />
    </div>
  );
}
