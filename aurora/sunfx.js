/* The cinematic Sun, shared by the preview (web/sunprev/) and the 3D module (solar.js). Unit radius, y = the Sun's rotation axis,
   z = towards the Earth when NOAA observed the regions. Real active regions (NOAA solar_regions.json), loops big and small,
   physics-shaped eruptions (flux rope → ribbons → post-flare arcade → coronal rain + CME), SDO looks (171 / 304 / HMI).
   createSun() → { group, halo, update(dt, camera), flare(big), setFilter(m), setColor(name), REG, sph, FM }.
   Add group and halo to the scene; place / scale / turn the group, update() keeps the halo on it. */
import * as THREE from 'three';
const NZ = `vec4 p289(vec4 x){return mod(((x*34.)+1.)*x,289.);}vec4 tis(vec4 r){return 1.79284291400159-.85373472095314*r;}
float sn(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+2.*C.xxx;vec3 x3=x0-1.+3.*C.xxx;i=mod(i,289.);vec4 p=p289(p289(p289(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));float n_=1./7.;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);vec4 nm=tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=nm.x;p1*=nm.y;p2*=nm.z;p3*=nm.w;vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
float fb(vec3 p){float a=.5,r=0.;for(int i=0;i<6;i++){r+=a*sn(p);p*=2.07;a*=.5;}return r;}`;

// one look for every CME (the eruption's and the measured ones in the 3D wind): a bubble with a bright rim and filaments around a dark
// cavity, the twisted flux rope inside as a croissant whose legs go back to the Sun, the particles piled up at the front + the sheath.
// Local frame: the Sun at the origin, y = the CME's axis, the front at y = 1 (scale the group by the front's distance); h = half-width.
let LG = null;
function lookGeo() { if (LG) return LG;
  const nu = 120, np = 6, UV = [], K = [], I = []; let o = 0;
  for (let k = -1; k < 6; k++) { for (let i = 0; i <= nu; i++) for (let j = 0; j <= np; j++) { UV.push(i / nu, j / np); K.push(k); }
    for (let i = 0; i < nu; i++) for (let j = 0; j < np; j++) { const a = o + i * (np + 1) + j, b = a + np + 1; I.push(a, b, a + 1, b, b + 1, a + 1); } o += (nu + 1) * (np + 1); }
  const core = new THREE.BufferGeometry(); core.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(o * 3), 3)); core.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  core.setAttribute('aK', new THREE.Float32BufferAttribute(K, 1)); core.setIndex(I);
  const N = 2600, p = new Float32Array(N * 3), q = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { const v = new THREE.Vector3().randomDirection(), fr = i < N * .55;   // front: piled-up particles on the outer shell; sheath: inside
    if (fr && v.y < -.2) v.y = -v.y * .6 + .1; v.normalize(); const rr = fr ? 1 + .035 * Math.random() : .55 + .42 * Math.pow(Math.random(), .6);
    p.set([v.x * rr, v.y * rr, v.z * rr], i * 3); q.set([fr ? 1 : 0, Math.random()], i * 2); }
  const pts = new THREE.BufferGeometry(); pts.setAttribute('position', new THREE.BufferAttribute(p, 3)); pts.setAttribute('aQ', new THREE.BufferAttribute(q, 2));
  return LG = { core, pts, sph: new THREE.SphereGeometry(1, 64, 48) }; }
export function makeCme() { const L = lookGeo(), g = new THREE.Group();
  const u = { t: { value: 0 }, k: { value: 0 }, h: { value: .42 }, s: { value: Math.random() * 20 }, c: { value: new THREE.Color(0xffd2a0) }, px: { value: 1 }, sc: { value: 1 } };
  const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
  const shell = new THREE.Mesh(L.sph, new THREE.ShaderMaterial({ uniforms: u, ...add, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vN,vV,vO;void main(){vO=position;vN=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: NZ + `uniform float t,k,s;uniform vec3 c;varying vec3 vN,vV,vO;void main(){
      float rim=pow(1.-abs(dot(vN,vV)),3.5),front=smoothstep(-.5,.4,vO.y),fil=.25+1.1*smoothstep(-.1,.6,fb(vO*3.5+vec3(0.,-t*.08,s)));
      gl_FragColor=vec4(c*rim*front*fil*k,1.);}` }));
  const core = new THREE.Mesh(L.core, new THREE.ShaderMaterial({ uniforms: u, ...add, side: THREE.DoubleSide,
    vertexShader: `uniform float h,t;attribute float aK;varying vec2 vU;varying vec3 vN,vV;varying float vK,vL;
      vec3 cl(float x){float sh=sin(h),R=sh/(1.+sh),Rc=.62*R,a=clamp(x*2.4,-1.75,1.75),lg=smoothstep(.72,1.,abs(x));   /* croissant: an arc in the bubble, legs to the Sun */
        vec3 arc=vec3(sin(a)*Rc,1.-R+cos(a)*Rc*.9,.18*Rc*sin(a*.5));return mix(arc,vec3(sign(x)*.03,0.,0.),lg);}
      void main(){float x=uv.x*2.-1.,ps=uv.y*6.28318,sh=sin(h),R=sh/(1.+sh);vec3 c=cl(x),T=normalize(cl(min(x+.01,1.))-cl(max(x-.01,-1.))),
        Nn=normalize(cross(T,vec3(0.,0.,1.))),Bn=cross(T,Nn),ring=cos(ps)*Nn+sin(ps)*Bn,q;vL=smoothstep(.72,1.,abs(x));
        float rho=R*.16*(1.-.75*vL);
        if(aK<0.)q=c+ring*rho*1.2;else{float th=aK*1.0472+4.*6.28318*uv.x+t*.3;q=c+(cos(th)*Nn+sin(th)*Bn)*rho+ring*rho*.1;}   /* 6 strands wound round it */
        vU=uv;vK=aK;vN=normalize(normalMatrix*ring);vec4 mv=modelViewMatrix*vec4(q,1.);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: NZ + `uniform float t,k,s;uniform vec3 c;varying vec2 vU;varying vec3 vN,vV;varying float vK,vL;void main(){float core=pow(abs(dot(vN,vV)),1.3),
      kn=.55+.45*fb(vec3(vU.x*14.-t*.3,vK*3.1,s));
      gl_FragColor=vec4(c*vec3(1.,.8,.62)*core*(vK<0.?core*.3:kn*1.1)*k*(1.-.6*vL),1.);}` }));
  const pts = new THREE.Points(L.pts, new THREE.ShaderMaterial({ uniforms: u, ...add,
    vertexShader: `uniform float h,t,k,px;attribute vec2 aQ;varying vec4 vC;void main(){float sh=sin(h),R=sh/(1.+sh);
      vec3 p=position+.02*vec3(sin(t*.7+aQ.y*40.),cos(t*.5+aQ.y*31.),sin(t*.6+aQ.y*23.));
      vec4 mv=modelViewMatrix*vec4(vec3(0.,1.-R,0.)+p*R,1.);float e=1.-clamp(position.y*.5+.5,0.,1.),q=length(position);
      vC=aQ.x>.5?vec4(1.,.82+.18*(1.-e),.62+.38*(1.-e),.75*k):vec4(1.,.6+.25*q,.4+.3*q,.35*k*q);
      gl_PointSize=(aQ.x>.5?2.3:2.8)*px;gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying vec4 vC;void main(){float f=smoothstep(.5,.1,length(gl_PointCoord-.5));if(f<=0.)discard;gl_FragColor=vec4(vC.rgb*vC.a*f,1.);}` }));
  for (const o of [shell, core, pts]) { o.frustumCulled = false; g.add(o); } g.visible = false;
  function set(h, k, t) { const sh = Math.sin(h), R = sh / (1 + sh); shell.position.set(0, 1 - R, 0); shell.scale.setScalar(R); u.h.value = h; u.k.value = k; u.t.value = t; }
  return { group: g, u, set, parts: [shell, core, pts] }; }
export async function createSun({ auto = true } = {}) {
const G = new THREE.Group(), camL = new THREE.Vector3(0, 0, 11), qFl = new THREE.Quaternion(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();
let cam = null;

const CMAP = `vec3 c171(float I){I=max(I,0.);return vec3(pow(I,.85)*1.15,pow(I,1.05)*.92,pow(I,1.9)*.55);}vec3 c304(float I){I=max(I,0.);return vec3(pow(I,.7)*1.2,pow(I,1.4)*.6,pow(I,3.)*.28);}`;
const VS = `varying vec3 vP,vN,vV;void main(){vP=position;vN=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`;
const U = { t: { value: 0 }, deep: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, hot: { value: new THREE.Color() },
  fl: { value: new THREE.Vector4(0, 0, 1, 0) }, rbA: { value: new THREE.Vector3(0, 0, 1) }, rbB: { value: new THREE.Vector3(0, 0, 1) }, rb: { value: new THREE.Vector4() }, fa: { value: new THREE.Vector4(1, 0, 0, 0) }, cl: { value: .95 }, hg: { value: 3 }, rim: { value: 1.2 }, spk: { value: .9 },   // chosen by the owner 30 Oct
 
  gInv: { value: new THREE.Matrix3() }, camL: { value: new THREE.Vector3(0, 0, 11) }, ctr: { value: new THREE.Vector3() }, fm: { value: 0 }, near: { value: 0 }, reg: { value: Array.from({ length: 16 }, () => new THREE.Vector3(0, 0, 1)) } };
// painted like the Rigel pictures: coloured middle, pale soft clouds, ink-spatter dark clusters, a thick puffy white rim, saturated glow
const PAL = { sun: [0x7a1e00, 0xff7a10, 0xfff0d0], rigel: [0x10249e, 0x2f8cff, 0xf2f9ff], f171: [0x3a2200, 0xc08a20, 0xffe7a0], f304: [0x400800, 0xd8401a, 0xffb070], hmi: [0x301000, 0xff9a40, 0xfff4e0] };

// the surface
G.add(new THREE.Mesh(new THREE.SphereGeometry(1, 192, 144), new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS,
  fragmentShader: NZ + CMAP + `uniform float t,cl,rim,spk,near,fm;uniform vec3 deep,mid,hot,camL,reg[16];uniform vec4 fl,fa,rb;uniform vec3 rbA,rbB;varying vec3 vP,vN,vV;
  void main(){vec3 n=normalize(vP);vec3 p=vP*1.6;vec3 q=vec3(fb(p+vec3(0.,t*.025,0.)),fb(p+vec3(4.1,1.7,-t*.02)),fb(p+vec3(8.3,2.8,t*.03)));
  float c=fb(p*1.8+q*2.2+vec3(t*.04));float fine=fb(vP*9.+q*3.-vec3(t*.06));float gran=1.-abs(sn(vP*40.+q*4.+t*.1));
  float mu=max(dot(vN,vV),0.);
  float cloud=cl*smoothstep(-.3,.3,c+.35*fine)*smoothstep(.0,.75,mu);                           /* the plasma of the earlier version */
  float holes=spk*smoothstep(.45,.75,fb(vP*4.+q*2.+vec3(3.)))*cloud;
  vec3 col=mix(hot*1.05,mid*.55,clamp(cloud,0.,1.));col=mix(col,deep*.45,clamp(holes,0.,1.)*.85);col*=.9+.2*gran;
  float bil=fb(n*7.+q*2.+vec3(t*.05)),e=1.-mu;                                                   /* thick, cloudy white rim */
  col=mix(col,hot*1.2,smoothstep(.42-rim*.18+.12*bil,.8-rim*.12+.08*bil,e)*(1.-near));
  if(near>0.){                                                     /* close up (like the Sunshine shot): relief from a height field, bright clumps, golden haze to the horizon */
    vec3 cr=reg[0];float dm=9.;for(int i=0;i<16;i++){float dd=distance(n,reg[i]);if(dd<dm){dm=dd;cr=reg[i];}}
    float act=1.-smoothstep(.05,.3,dm);vec3 gold=vec3(1.,.78,.32);
    vec3 V=normalize(camL-vP);float nv=max(dot(n,V),0.);
    float mott=fb(n*90.+q*2.+vec3(t*.02));
    float gr=fb(n*260.+q*4.+vec3(t*.08)),net=1.-abs(sn(n*180.+q*3.+vec3(t*.06)));
    float clump=smoothstep(.05,.4,fb(n*28.+q*1.5+vec3(t*.01)))*smoothstep(.05,.45,fb(n*140.+q*3.+vec3(t*.04))+.25*gr);
    clump*=.5+.9*act;
    vec3 e1=normalize(cross(cr,vec3(.13,1.,.07))),e2=cross(cr,e1),v=n-cr;
    float ang=atan(dot(v,e2),dot(v,e1)),rr=length(v);
    float fib=smoothstep(.25,.65,fb(vec3(cos(ang)*60.,sin(ang)*60.,rr*40.-t*.05)))*smoothstep(.006,.02,rr)*(1.-smoothstep(.03,.07,rr));
    vec3 base=mix(deep*.35,mid*.6,smoothstep(-.35,.45,mott+.35*gr))*(.7+.45*net*net);
    vec3 cl2=base+gold*hot*(1.6*clump*clump+.6*fib)+gold*hot*1.4*exp(-pow(rr/.012,2.))*act+gold*hot*.45*pow(1.-nv,7.);   /* the ground glows towards the horizon */
    col=mix(col,cl2,near);}
  if(fm>.5){   /* SDO looks: same Sun, same regions, seen by one instrument */
    vec3 cr=reg[0];float dm=9.;for(int i=0;i<16;i++){float dd=distance(n,reg[i]);if(dd<dm){dm=dd;cr=reg[i];}}
    float act=1.-smoothstep(.03,.2,dm),netw=pow(1.-abs(sn(n*55.+q*2.)),4.),hole=smoothstep(.5,.75,fb(vP*2.2+q*1.5+vec3(7.)))*(1.-act);
    vec3 Ea=normalize(cross(vec3(0.,1.,0.),cr));float side=dot(n-cr,Ea),pol=sign(side)*(cr.y>0.?1.:-1.);   /* leading / following polarity, flipped between hemispheres (Hale) */
    if(fm<1.5){         /* AIA 171 Å (Fe IX, ~0.6 MK): quiet network faint, active regions glowing, coronal holes dark, brighter towards the limb */
      float I=.16+.2*smoothstep(-.3,.6,c)+.32*netw*(.5+.5*fine)+.75*act*act*(.6+.4*fine)-.14*hole;
      col=c171(I*(.85+.45*pow(1.-mu,3.)));}
    else if(fm<2.5){    /* AIA 304 Å (He II, ~50 000 K): bright chromospheric network, plage, dark filaments */
      float fil=(1.-smoothstep(0.,.035,abs(sn(n*5.+q*1.2+vec3(2.)))))*smoothstep(.15,.45,fb(n*3.+vec3(5.)));
      float I=.2+.5*netw*(.6+.4*gran)+.18*fine+.65*act*(.5+.5*fine);I*=1.-.65*fil;
      col=c304(I*(.9+.25*pow(1.-mu,3.)));}
    else if(fm<3.5){    /* HMI continuum (visible light, photosphere): limb darkening, granulation, sunspots with umbra + penumbra, faculae near the limb */
      float um=1.-smoothstep(.009,.016,dm+.003*fine),pen=1.-smoothstep(.02,.038,dm+.006*fine),sm2=smoothstep(.6,.7,fb(n*45.+vec3(1.)))*act;
      float I=(.33+.67*mu)*(.93+.07*gran)+.18*act*pow(1.-mu,2.)*netw;
      I*=1.-.5*max(pen,sm2*.8);I*=1.-.7*um;col=vec3(1.,.58,.22)*I*.8;}
    else{               /* HMI magnetogram (line of sight): white = field towards us, black = away; weak near the limb */
      float B=1.7*pol*smoothstep(.16,.03,dm)*smoothstep(.0,.025,abs(side))*(.6+.6*fine)+.7*sn(n*95.)*smoothstep(.25,.6,abs(sn(n*95.)))*(1.-hole*.6);
      col=vec3(.5+.5*clamp(B*mu,-1.,1.))*.85;}}
  vec3 d=n-fl.xyz;float al=dot(d,fa.xyz),ac=dot(d,cross(fl.xyz,fa.xyz)),sep=.012+fa.w*.01;
  float rib=exp(-al*al*220.)*(exp(-pow((ac-sep)*90.,2.))+exp(-pow((ac+sep)*90.,2.)));
  col+=hot*fl.w*(2.5*exp(-dot(d,d)*120.)+2.*rib);
  if(rb.y>0.){   /* flare ribbons: where field lines reconnect under the rising rope, two bright strips either side of the polarity line move apart, hooking round the rope's feet */
    vec3 c0=normalize(rbA+rbB),e=normalize(rbB-rbA),pp=normalize(cross(c0,e)),dn=n-c0;float a=dot(dn,e),b=dot(dn,pp),sep=rb.x,L=rb.z,w=L*.045;
    float aA=dot(rbA-c0,e),aB=dot(rbB-c0,e),bA=dot(rbA-c0,pp),bB=dot(rbB-c0,pp),sB=bB>0.?1.:-1.;
    float r1=exp(-pow((b-sB*sep)/w,2.))*smoothstep(-.7*L,-.3*L,a)*(1.-smoothstep(aB-.04*L,aB+.04*L,a));
    float r2=exp(-pow((b+sB*sep)/w,2.))*smoothstep(aA-.04*L,aA+.04*L,a)*(1.-smoothstep(.3*L,.7*L,a));
    vec2 qB=vec2(a-aB,b-bB),qA=vec2(a-aA,b-bA);
    float hB=exp(-pow((length(qB)-abs(sB*sep-bB))/w,2.))*smoothstep(-.1,.4,qB.x/(length(qB)+1e-5));
    float hA=exp(-pow((length(qA)-abs(-sB*sep-bA))/w,2.))*smoothstep(-.1,.4,-qA.x/(length(qA)+1e-5));
    float kern=.35+1.1*smoothstep(-.3,.6,fb(vec3(a*260.,b*260.,t*.25)));
    float inner=smoothstep(sep,sep*.2,abs(b))*smoothstep(1.1*L,.5*L,abs(a));                /* the swept floor between them, cooling */
    col+=hot*rb.y*(2.4*(r1+r2+.8*(hA+hB))*kern+.22*inner*(.6+.4*kern));}
  gl_FragColor=vec4(col,1.);}` })));

// camera-facing card through the centre: the puffy edge outside the limb, a saturated round glow, faint broad corona
const halo = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `varying vec2 vQ;varying vec3 vW;void main(){vQ=position.xy;vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
  fragmentShader: NZ + CMAP + `uniform float t,hg,rim,near,fm;uniform vec3 mid,hot;uniform mat3 gInv;uniform vec3 ctr;varying vec2 vQ;varying vec3 vW;
  void main(){float b=length(vQ);if(b<.99)discard;vec3 dl=normalize(gInv*(vW-ctr));float h=b-1.;
  float bil=.6*fb(dl*7.+vec3(t*.05))+.4*fb(dl*17.+vec3(t*.08));
  float puff=(1.-smoothstep(0.,(.02+.045*max(bil+.25,0.))*(.6+.4*rim),h));                       /* billows just past the edge */
  float glow=hg*(.55*exp(-h*3.)+.22*exp(-h*.8))*smoothstep(8.,3.,b);
  float cor=pow(1./b,4.)*(.5+.8*max(fb(dl*1.8+vec3(t*.01)),0.))*smoothstep(6.,1.5,b);
  vec3 c=(mid*glow*.5+mix(mid,hot,.3)*cor*.12+hot*puff*1.05)*(1.-near*.95);
  if(near>0.){vec3 gold=vec3(1.,.78,.32);                                                        /* close up: spicule flames and a glowing horizon */
    float fl1=fb(dl*420.+vec3(0.,0.,-t*.5)+vec3(h*140.)),fl2=fb(dl*170.+vec3(3.,0.,-t*.3)+vec3(h*60.));
    float ht=.004+.012*max(fl2+.2,0.);
    float sp=smoothstep(.0,.5,fl1+.3)*(1.-smoothstep(ht*.4,ht,h))*(.25+.75*smoothstep(-.15,.35,fb(dl*45.+vec3(t*.02))));   /* in clusters, like the shot */
    float hz=1.5*exp(-h*200.)+.6*exp(-h*35.);                                            /* brighter glowing horizon */
    c+=near*(hot*gold*(1.4*sp+.9*hz)+mid*.025*exp(-h*6.));}
  if(fm>.5){float rr=fb(dl*11.+vec3(t*.01)),pr=smoothstep(.5,.68,fb(dl*6.+vec3(9.)));   /* noise fixed along each radius = rays */
    if(fm<1.5)c=c171(.55*exp(-h*7.)*(.55+.8*max(rr,0.))+.08*exp(-h*2.2)*(.6+.6*rr))*(1.-near*.6);                /* 171: fans and rays of the corona */
    else if(fm<2.5)c=c304(1.1*exp(-h*70.)*(.6+.6*fb(dl*90.+vec3(t*.05)))+.6*pr*exp(-h*14.))*(1.-near*.5);         /* 304: spicule fringe + prominences */
    else c=vec3(0.);}                                                                                              /* HMI sees only the photosphere */
  gl_FragColor=vec4(c,1.);}` }));

// loops: thin translucent arcs of light rising straight up from the surface, several strands each, brighter feet, swaying a little
const loops = new THREE.Group(); G.add(loops); const LS = [], LIFE = [], REG = [];
const sph = (la, lo, r) => new THREE.Vector3(r * Math.cos(la) * Math.sin(lo), r * Math.sin(la), r * Math.cos(la) * Math.cos(lo));
const LU = { k: { value: 1.8 }, us: { value: 1 } };   // us = world units per solar radius
// LV: the loop sways and wobbles like plasma; during an eruption (brk 0 → 1) it stretches up, thins at the top, snaps:
// the top flies off and fades, the legs drop back and the loop grows again
const LV = NZ + `uniform float t,s,sw,brk,us;uniform vec3 ax;attribute float aSeed;attribute vec3 aAx;varying float vS;varying vec2 vU;varying vec3 vN,vV;varying float vD;void main(){vU=uv;float S=s+aSeed;vS=S;float arc=sin(uv.x*3.14159),g=abs(uv.x-.5);
  vec3 rd=normalize(position);float hg=length(position)-1.;
  float st=smoothstep(0.,.45,brk),top=1.-smoothstep(.14,.2,g),fly=smoothstep(.5,1.,brk);
  float snap=smoothstep(.5,.56,brk)*(1.-smoothstep(.56,1.,brk));
  float f=top>.5?1.+.9*arc*arc*st:1.+.9*arc*arc*st*(1.-smoothstep(.5,.56,brk))-.45*arc*snap;
  vec3 wob=vec3(sn(position*3.+vec3(t*.15+S)),sn(position*3.+vec3(7.,t*.15+S,0.)),sn(position*3.+vec3(13.,0.,t*.15+S)));
  vec3 p=rd*(1.+hg*f)+rd*top*fly*.7+wob*(aSeed>.5?length(aAx)*2.5:.014)*arc+(ax*sw+aAx)*arc*(sin(t*.3+S)*.6+sin(t*.8+S*1.7)*.25);
  vN=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(p,1.);vV=normalize(-mv.xyz);vD=-mv.z/us;gl_Position=projectionMatrix*mv;}`;
const LF = NZ + `uniform float t,s,b,k,life,brk,near,fine;uniform vec3 c;varying float vS;varying vec2 vU;varying vec3 vN,vV;varying float vD;void main(){
  float core=pow(abs(dot(vN,vV)),1.6),g=abs(vU.x-.5);
  float rain=exp(-pow((fract(g*3.5-t*.12+vS*.37)-.5)*7.,2.));                                      /* plasma knots sliding down the legs */
  float flow=.6+.25*smoothstep(-.2,.6,fb(vec3(vU.x*4.-t*.3+vS,vS,t*.04)))+.45*rain;
  float foot=1.+exp(-pow(vU.x*8.,2.))+exp(-pow((1.-vU.x)*8.,2.));
  float neck=1.-.7*smoothstep(.15,.48,brk)*(1.-step(.5,brk))*exp(-pow((g-.17)/.03,2.));              /* thins where it will break */
  float broken=step(.5,brk)*smoothstep(.13,.16,g)*(1.-smoothstep(.2,.24,g));                     /* the gap */
  float topGone=(1.-smoothstep(.14,.2,g))*smoothstep(.55,.95,brk);                               /* the piece that flew off fades */
  float e=(fine>.5?near*smoothstep(.01,.05,vD)*(.55+.45*sin(t*.25+vS*2.))*(vS>99.?.5:1.):smoothstep(.05+.25*near,.12+.5*near,vD))*smoothstep(0.,.05,vU.x)*smoothstep(1.,.95,vU.x)*neck*(1.-broken)*(1.-topGone);
  gl_FragColor=vec4(c*mix(vec3(1.),vec3(1.,.72,.3),near)*core*flow*foot*e*b*k*life*(fine>.5?1.:1.-near*.6),1.);}`;
// active regions: today's from NOAA where they really are (sizes from their area), the far side filled with made-up ones in the same latitude belts
async function realRegions() { try { const ac = new AbortController(); setTimeout(() => ac.abort(), 4000);
    const j = await (await fetch('https://services.swpc.noaa.gov/json/solar_regions.json', { signal: ac.signal })).json(), d = j.map(x => x.observed_date).sort().pop();
    return j.filter(x => x.observed_date === d && x.latitude != null && x.longitude != null).sort((a, b) => (b.area || 0) - (a.area || 0)).slice(0, 12)
      .map(x => ({ la: x.latitude * Math.PI / 180, lo: -x.longitude * Math.PI / 180, k: Math.min(1.7, Math.max(.45, Math.sqrt(x.area || 15) / 14)), fp: (x.m_flare_probability || 1) + 3 * (x.x_flare_probability || 0), id: x.region })); }
  catch (e) { return []; } }
const RR = await realRegions(), nReal = RR.length;   // NOAA longitude + = east (left as seen from Earth)
while (RR.length < 16) { const sg = Math.random() < .5 ? -1 : 1; RR.push({ la: sg * (.09 + Math.random() * .5), lo: nReal ? Math.PI + (Math.random() - .5) * 3.2 : Math.random() * 6.28, k: .45 + Math.random() * .9, fp: 3 }); }
const plaw = (a, b, al) => Math.min(b, a * Math.pow(1 - Math.random(), -1 / al));   // many small, few big
function around(c, an, d) { const E = new THREE.Vector3(0, 1, 0).cross(c).normalize(), N = c.clone().cross(E); return c.clone().addScaledVector(E, Math.cos(an) * d).addScaledVector(N, Math.sin(an) * d).normalize(); }
const arch = (a, b, H, n) => { const pts = []; for (let q = 0; q <= n; q++) { const u = q / n; pts.push(a.clone().lerp(b, u).normalize().multiplyScalar(1 + H * Math.sin(Math.PI * u))); } return pts; };
function addMerged(list, la, lo) {   // many thin loops in one mesh: seed + sway axis per vertex
  const P = [], Nn = [], UV = [], S = [], A = [], I = []; let o = 0;
  for (const l of list) { const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(l.pts), 24, l.r, 5, false), n = g.attributes.position.count;
    for (const v of g.attributes.position.array) P.push(v); for (const v of g.attributes.normal.array) Nn.push(v); for (const v of g.attributes.uv.array) UV.push(v);
    for (let i = 0; i < n; i++) { S.push(l.seed); A.push(l.ax.x, l.ax.y, l.ax.z); } for (const i of g.index.array) I.push(i + o); o += n; g.dispose(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setAttribute('aSeed', new THREE.Float32BufferAttribute(S, 1)); g.setAttribute('aAx', new THREE.Float32BufferAttribute(A, 3)); g.setIndex(I);
  const mat = new THREE.ShaderMaterial({ uniforms: { t: U.t, c: { value: new THREE.Color() }, s: { value: 0 }, b: { value: 1 }, k: LU.k, us: LU.us, life: { value: 1 }, near: U.near, fine: { value: 1 }, ax: { value: new THREE.Vector3() }, sw: { value: 0 }, brk: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: LV, fragmentShader: LF });
  const me = new THREE.Mesh(g, mat); loops.add(me); LS.push({ me, la, lo }); }
function smallLoop(c, an, sp, seed) { const a = around(c, an, sp), b = around(c, an + Math.PI, sp), ax = new THREE.Vector3().crossVectors(b.clone().sub(a), c).normalize();
  return { pts: arch(a, b, sp * (.7 + Math.random() * .8), 24), r: .0004 + sp * .015, seed, ax: ax.multiplyScalar(sp * .1) }; }
for (const R of RR) { const { la, lo, k: rk } = R, C = sph(la, lo, 1), joy = la * .5, reg = { la, lo, fp: R.fp, id: R.id, m: [], an: joy, k: rk };   // loops lie along the region's axis (Joy's law tilt)
  for (let k = 0, nb = 2 + Math.round(rk * 1.5); k < nb; k++) { const sp = (.04 + Math.random() * .11) * rk, an = joy + (Math.random() - .5) * .8, c0 = around(C, Math.random() * 6.28, Math.random() * .04 * rk),
      a0 = around(c0, an, sp), b0 = around(c0, an + Math.PI, sp), H = sp * (1.3 + Math.random() * 1.6), lean = (Math.random() - .5) * sp * .5,
      ax = new THREE.Vector3().crossVectors(b0.clone().sub(a0), c0).normalize(), s = Math.random() * 30, life = { value: 0 };
    for (let j = 0; j < 2; j++) {
      const o = new THREE.Vector3().randomDirection().multiplyScalar(sp * .05), a = a0.clone().add(o).normalize(), bb = b0.clone().sub(o).normalize(), hh = H * (.9 + Math.random() * .2);
      const pts = []; for (let q = 0; q <= 48; q++) { const u = q / 48, arc = Math.sin(Math.PI * u);   // a clean arch: along the chord, lifted straight up
        pts.push(a.clone().lerp(bb, u).normalize().multiplyScalar(1 + hh * arc).addScaledVector(ax, lean * arc)); }
      const mat = new THREE.ShaderMaterial({ uniforms: { t: U.t, c: { value: new THREE.Color() }, s: { value: s + j * .7 }, b: { value: 1 }, k: LU.k, us: LU.us, life, near: U.near, fine: { value: 0 }, ax: { value: ax }, sw: { value: sp * .15 }, brk: { value: 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: LV, fragmentShader: LF });
      const me = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, .0025 + Math.random() * .003, 8, false), mat); loops.add(me); LS.push({ me, la, lo }); reg.m.push(mat); }
    LIFE.push({ life, ph: Math.random() * 6.28, per: 30 + Math.random() * 40 }); }
  const sm = []; for (let q = 0, ns = Math.round(30 * rk); q < ns; q++)   // the region's small loops, denser in the middle
    sm.push(smallLoop(around(C, Math.random() * 6.28, .13 * rk * Math.pow(Math.random(), 1.3)), joy + (Math.random() - .5) * 1.2, plaw(.005, .05, 1.6), 1 + Math.random() * 60));
  addMerged(sm, la, lo);
  REG.push(reg); }
{ const qs = []; for (let q = 0; q < 160; q++) qs.push(smallLoop(new THREE.Vector3().randomDirection(), Math.random() * 6.28, plaw(.003, .012, 2), 100 + Math.random() * 60)); addMerged(qs, 0, 0); }   // quiet Sun: tiny loops everywhere
REG.forEach((r, i) => i < 16 && U.reg.value[i].copy(sph(r.la, r.lo, 1)));

let pal = 'sun';
function setPal() { const P = PAL[pal]; U.deep.value.setHex(P[0]); U.mid.value.setHex(P[1]); U.hot.value.setHex(P[2]);
  for (const l of LS) l.me.material.uniforms.c.value.setHex(P[2]).lerp(new THREE.Color(P[1]), .15).multiplyScalar(1.1); }
setPal();
function setColor(n) { if (U.fm.value || !PAL[n]) return; pal = n; setPal(); }
// SDO looks: 171 = hot corona loops, 304 = chromosphere + prominences, HMI = visible light / magnetic field (no corona, no loops)
const FM = ['Normal', 'AIA 171', 'AIA 304', 'HMI light', 'HMI magnetic'], FPAL = [null, 'f171', 'f304', 'hmi', 'hmi'], FLG = [1, 1.1, .35, 0, 0];
let palN = pal;
function setFilter(m) { if (!U.fm.value) palN = pal; U.fm.value = m; pal = FPAL[m] || palN; setPal();
  LU.k.value = 1.8 * FLG[m]; loops.visible = FLG[m] > 0; for (const me of [rope, arcade, jet, ...cmeL.parts]) me.material.visible = m < 3; }

let FL = null;
function limbRegion() {   // a region near the edge as seen now, so the loops breaking stand out against space
  const v = camL.clone().normalize(); let best = null, bs = -1;
  for (const r of REG) { const w = sph(r.la, r.lo, 1), d = w.dot(v), sc = (d > -.15 ? 1 - Math.abs(d - .1) : 0) + Math.random() * .25; if (sc > bs) { bs = sc; best = r; } }
  return best; }
function viewRegion() {   // low down: the region nearest the middle of the view that is in front of us and not hidden past the horizon
  const P = camL; let best = null, bs = 9;
  for (const r of REG) { const w = sph(r.la, r.lo, 1), s = w.clone().applyMatrix4(G.matrixWorld).project(cam); if (s.z > 1 || Math.abs(s.x) > .85 || Math.abs(s.y) > .95 || w.dot(P.clone().sub(w)) < -.03) continue;
    const sc = Math.hypot(s.x, s.y + .3); if (sc < bs) { bs = sc; best = r; } }
  return best; }
// eruption effects: a flash at the footpoints + a smooth plasma jet rising from them (seen from far and from low down)
const FXU = { pm: { value: 1.5 }, gain: { value: 1 }, t: U.t, age: { value: 99 }, c: { value: new THREE.Color() }, s: { value: 0 } };
const flash = new THREE.Mesh(new THREE.PlaneGeometry(.5, .5), new THREE.ShaderMaterial({ uniforms: FXU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `varying vec2 vQ;void main(){vQ=position.xy/.25;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform float age;uniform vec3 c;varying vec2 vQ;void main(){float r2=dot(vQ,vQ),k=smoothstep(0.,.12,age)*exp(-age*1.1);
    gl_FragColor=vec4(c*k*(4.*exp(-r2*60.)+1.2*exp(-r2*12.)+.3*exp(-r2*3.)),1.);}` }));
const jetG = new THREE.CylinderGeometry(.16, .015, .6, 32, 48, true); jetG.translate(0, .3, 0);
const jet = new THREE.Mesh(jetG, new THREE.ShaderMaterial({ uniforms: FXU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: `uniform float t,s;varying vec2 vU;varying vec3 vN,vV;void main(){vU=uv;vec3 p=position;float y=uv.y;
    p.x+=sin(y*5.+t*.8+s)*.05*y;p.z+=cos(y*4.+t*.6+s)*.04*y;                                   /* the column sways and twists as it rises */
    vN=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(p,1.);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`,
  fragmentShader: NZ + `uniform float t,age,s,pm,gain;uniform vec3 c;varying vec2 vU;varying vec3 vN,vV;void main(){float y=vU.y;
    float front=.15+.85*(1.-exp(-age*.55));                                                     /* the front climbs, slowing down */
    float fr=1.-smoothstep(front-.18,front,y);
    float flow=smoothstep(-.3*(pm-1.),.6-.1*(pm-1.),fb(vec3(cos(vU.x*6.283)*1.5,sin(vU.x*6.283)*1.5,y*5.-t*1.2+s)));   /* knots of plasma streaming up */
    float core=pow(abs(dot(vN,vV)),1.4),fade=smoothstep(0.,.4,age)*(1.-smoothstep(4.5,8.,age));
    gl_FragColor=vec4(c*core*flow*fr*fade*(1.+2.5*exp(-y*7.))*(1.-.6*y)*.9*(.75+.25*pm)*gain,1.);}` }));
flash.visible = jet.visible = false; G.add(flash, jet);

function fxStart(d) { const P = PAL[pal]; FXU.c.value.setHex(P[2]).lerp(new THREE.Color(0xffc060), .35); FXU.age.value = 0; FXU.s.value = Math.random() * 20;
  flash.position.copy(d).multiplyScalar(1.012); jet.position.copy(d); { const m = FXU.pm.value - 1; jet.scale.set(1 + .45 * m, 1 + .2 * m, 1 + .45 * m); } jet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(.25)).normalize());
  flash.visible = jet.visible = true; }
function fxTick(dt) { ropeTick(dt); if (!jet.visible && !flash.visible) return; FXU.age.value += dt; flash.quaternion.copy(qFl);
  if (FXU.age.value > 9) flash.visible = jet.visible = false; }
// big eruption = a twisted magnetic flux rope. It lies low along the line between the region's two polarities (S-shaped, ends anchored
// in opposite polarities), rises slowly, then runs away faster and faster (torus instability); the legs stay put, the top widens and turns (writhe).
// The flare flash comes when the fast rise starts (reconnection under the rope). Shape drawn in the vertex shader from a few numbers.
const RU = { t: U.t, c: { value: new THREE.Color() }, rA: { value: new THREE.Vector3() }, rB: { value: new THREE.Vector3() }, rH: { value: 0 }, rSh: { value: .6 }, rRot: { value: 0 },
  rRho: { value: .01 }, rTw: { value: 1.6 }, rSpin: { value: 0 }, rL: { value: .1 }, rFade: { value: 0 }, rS: { value: 0 } };
const ropeG = (() => { const nu = 160, np = 8, UV = [], K = [], I = []; let o = 0;
  for (let k = -1; k < 7; k++) { for (let i = 0; i <= nu; i++) for (let j = 0; j <= np; j++) { UV.push(i / nu, j / np); K.push(k); }
    for (let i = 0; i < nu; i++) for (let j = 0; j < np; j++) { const a = o + i * (np + 1) + j, b = a + np + 1; I.push(a, b, a + 1, b, b + 1, a + 1); } o += (nu + 1) * (np + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(o * 3), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('aK', new THREE.Float32BufferAttribute(K, 1)); g.setIndex(I); return g; })();
const rope = new THREE.Mesh(ropeG, new THREE.ShaderMaterial({ uniforms: RU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: `uniform vec3 rA,rB;uniform float rH,rSh,rRot,rRho,rTw,rSpin,rL;attribute float aK;varying vec2 vU;varying vec3 vN,vV;varying float vK,vH;
    vec3 axisP(float u){vec3 up=normalize(rA+rB),P=normalize(cross(rB-rA,up));float s=max(sin(3.14159*u),0.);
      float lift=rH*pow(s,mix(1.,.45,smoothstep(0.,4.,rH/rL)));                               /* the top grows round and wide as it climbs, legs stay steep */
      return normalize(mix(rA,rB,u))*(1.+lift)+P*(rSh*rL*.45*sin(6.28318*u)+(1.-2.*u)*lift*rRot);}   /* S-shape + the top turning */
    void main(){float u=uv.x,ps=uv.y*6.28318,s=sin(3.14159*u);vec3 c=axisP(u),T=normalize(axisP(min(u+.004,1.))-axisP(max(u-.004,0.))),
      Nn=normalize(normalize(c)-T*dot(normalize(c),T)),Bn=cross(T,Nn),ring=cos(ps)*Nn+sin(ps)*Bn,q;
      float rho=rRho*(.25+.75*sqrt(s))*(1.+1.2*rH/rL*s);                                       /* thin at the feet, swelling as it rises */
      if(aK<0.)q=c+ring*rho*1.2;
      else{float th=aK*.8976+rTw*6.28318*u+rSpin;q=c+(cos(th)*Nn+sin(th)*Bn)*rho+ring*(rho*.1+.0005);}   /* 7 strands wound round the axis */
      vU=uv;vK=aK;vH=rH/rL;vN=normalize(normalMatrix*ring);vec4 mv=modelViewMatrix*vec4(q,1.);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`,
  fragmentShader: NZ + `uniform float t,rFade,rS;uniform vec3 c;varying vec2 vU;varying vec3 vN,vV;varying float vK,vH;void main(){float u=vU.x,core=pow(abs(dot(vN,vV)),1.3),
      ends=smoothstep(0.,.03,u)*smoothstep(1.,.97,u);
    if(vK<0.){float dr=smoothstep(-.25,.65,fb(vec3(abs(u-.5)*9.-t*.9+rS,vU.y*2.,rS)));          /* cool plasma draining down both legs */
      gl_FragColor=vec4(c*core*core*dr*.3*rFade*ends,1.);}
    else{float kn=.55+.45*fb(vec3(u*16.-t*.4,vK*3.1,rS));gl_FragColor=vec4(c*core*kn*1.25*rFade*ends/(1.+.25*vH),1.);}}` }));
rope.visible = false; rope.frustumCulled = false; G.add(rope);
const RP = { age: 99, h0: 0, L: .1, lit: false };
function ropeStart(C, an, rk) { const L = (.06 + Math.random() * .04) * Math.max(.7, rk), P = PAL[pal];
  RU.rA.value.copy(around(C, an + Math.PI / 2 - .35, L)); RU.rB.value.copy(around(C, an - Math.PI / 2 - .35, L));   // across the polarity line, sheared
  RU.rL.value = RP.L = L; RU.rRho.value = L * .1; RU.rS.value = Math.random() * 30; RU.rTw.value = 1.3 + Math.random() * .8;
  RU.c.value.setHex(P[2]).lerp(new THREE.Color(0xff9a50), .3); RP.h0 = L * .3; RP.age = 0; RP.lit = false; rope.visible = true; U.rbA.value.copy(RU.rA.value); U.rbB.value.copy(RU.rB.value); rope.userData.cme = true; CM.h = CM.v = CM.prev = 0; CM.d.copy(RU.rA.value).add(RU.rB.value).normalize(); CM.x.copy(RU.rB.value).sub(RU.rA.value); CU.s.value = Math.random() * 20; CU.c.value.setHex(P[2]).lerp(new THREE.Color(0xffffff), .1); AU.c.value.setHex(P[2]).lerp(new THREE.Color(P[1]), .15); }
function ropeTick(dt) { if (RP.age > 32) { arcade.visible = cmeL.group.visible = false; return; } const a = RP.age += dt, L = RP.L;
  RU.rH.value = a < 1.5 ? RP.h0 * (1 + .25 * a) : RP.h0 * 1.375 + L * .45 * (Math.exp((a - 1.5) / 1.25) - 1);   // slow rise, then runaway
  RU.rRot.value = .4 * THREE.MathUtils.smoothstep(a, 1.5, 6); RU.rSh.value = .6 * (1 - .5 * THREE.MathUtils.smoothstep(a, 1.5, 5)); RU.rSpin.value = a * .45;
  RU.rFade.value = THREE.MathUtils.smoothstep(a, 0, .9) * (1 - THREE.MathUtils.smoothstep(a, 7, 10));
  if (a > 1.5 && !RP.lit) { RP.lit = true; FXU.age.value = 0; flash.visible = true; }   // reconnection under the rope: the flare
  cmeTick(dt, a, RU.rH.value); if (a > 10 || RU.rH.value > 6) rope.visible = false;
  const tf = a - 1.5, sm = THREE.MathUtils.smoothstep;   // the ribbons part fast at first, then slower (reconnection running higher up)
  const sepAt = x => L * (.1 + .6 * (1 - Math.exp(-Math.max(0, x) / 3.5)));
  arcade.visible = tf > .5; AU.L.value = L;
  for (let j = 0; j < NSH; j++) { const tb = .8 + j * 1.6, x = tf - tb, sp = sepAt(tb);
    AU.aSep.value[j] = sp; AU.aShr.value[j] = sp * 1.1 * (1 - j / NSH);                              // strong shear first, weak later
    AU.aH.value[j] = sp * (1 + .45 * Math.exp(-Math.max(0, x) / 1.2));                                // just-formed loops shrink down
    AU.aBr.value[j] = x < 0 ? 0 : sm(x, 0, .8) * (.9 * Math.exp(-x / 6) + .25) * (1 - sm(tf, 22, 30)) * (x < 2 ? 1.6 : 1);
    AU.aRn.value[j] = sm(x, 5, 9) * (1 - sm(tf, 24, 30)); }                                          // rain once the shell has cooled
  U.rb.value.set(sepAt(tf), tf < 0 ? 0 : sm(tf, 0, .35) * (1.4 * Math.exp(-tf / 2.5) + .45) * (1 - sm(tf, 9, 14)), L, tf); }
// post-flare arcade: every field line reconnected under the rope closes into a new loop whose feet sit on the two ribbons. Loops come in
// shells, each one born higher and wider than the last (the ribbons have moved apart), less sheared, first hot and bright with a bright top,
// shrinking a little after they form, then cooling and fading.
const NSH = 7, NLP = 24, AU = { t: U.t, rbA: U.rbA, rbB: U.rbB, L: { value: .1 }, c: { value: new THREE.Color() },
  aSep: { value: new Array(NSH).fill(0) }, aBr: { value: new Array(NSH).fill(0) }, aH: { value: new Array(NSH).fill(0) }, aShr: { value: new Array(NSH).fill(0) }, aRn: { value: new Array(NSH).fill(0) } };
const arcG = (() => { const nu = 64, np = 6, UV = [], J = [], I = []; let o = 0;
  for (let j = 0; j < NSH; j++) for (let k = 0; k < NLP; k++) { const al = -1 + 2 * (k + .2 + .6 * Math.random()) / NLP, sd = Math.random();
    for (let i = 0; i <= nu; i++) for (let q = 0; q <= np; q++) { UV.push(i / nu, q / np); J.push(j, al, sd); }
    for (let i = 0; i < nu; i++) for (let q = 0; q < np; q++) { const a = o + i * (np + 1) + q, b = a + np + 1; I.push(a, b, a + 1, b, b + 1, a + 1); } o += (nu + 1) * (np + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(o * 3), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('aJ', new THREE.Float32BufferAttribute(J, 3)); g.setIndex(I); return g; })();
const arcade = new THREE.Mesh(arcG, new THREE.ShaderMaterial({ uniforms: AU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: `uniform vec3 rbA,rbB;uniform float L,t,aSep[${NSH}],aBr[${NSH}],aH[${NSH}],aShr[${NSH}],aRn[${NSH}];attribute vec3 aJ;varying vec2 vU;varying vec3 vN,vV;varying float vB,vS,vY,vR;
    float rain(float u,float sd){float r=0.;for(int k=0;k<3;k++){float ph=fract(sd*7.31+float(k)*.379+t*(.07+.03*sd)),x=.5+(mod(float(k)+floor(sd*5.),2.)>.5?.5:-.5)*ph*ph;r+=exp(-pow((u-x)/.022,2.))*smoothstep(0.,.15,ph)*smoothstep(1.,.85,ph);}return r;}
    vec3 c0,e,pp;float sB;
    vec3 lp(float u,float sep,float sh,float H,float a){vec3 f1=c0+e*(a+sh*sB)+pp*sB*sep,f2=c0+e*(a-sh*sB)-pp*sB*sep;
      return normalize(mix(f1,f2,u))*(1.+H*sin(3.14159*u));}
    void main(){int j=int(aJ.x+.5);float sep=aSep[j],H=aH[j]*(.85+.3*aJ.z),sh=aShr[j],a=aJ.y*L*.75,u=uv.x;
      c0=normalize(rbA+rbB);e=normalize(rbB-rbA);pp=normalize(cross(c0,e));sB=dot(rbB-c0,pp)>0.?1.:-1.;
      vec3 c=lp(u,sep,sh,H,a),T=normalize(lp(min(u+.01,1.),sep,sh,H,a)-lp(max(u-.01,0.),sep,sh,H,a)),Nn=normalize(normalize(c)-T*dot(normalize(c),T)),Bn=cross(T,Nn),
        ring=cos(uv.y*6.28318)*Nn+sin(uv.y*6.28318)*Bn;vR=aRn[j]*rain(u,aJ.z);vec3 q=c+ring*L*(.008+.006*aJ.z)*(1.+1.3*min(vR,1.));
      vU=uv;vB=aBr[j]*(.6+.8*aJ.z)*smoothstep(.75,.55,abs(aJ.y));vS=aJ.z*40.+float(j)*3.;vY=sin(3.14159*u);
      vN=normalize(normalMatrix*ring);vec4 mv=modelViewMatrix*vec4(q,1.);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`,
  fragmentShader: NZ + `uniform float t;uniform vec3 c;varying vec2 vU;varying vec3 vN,vV;varying float vB,vS,vY,vR;void main(){if(vB<.002&&vR<.002)discard;
    float core=pow(abs(dot(vN,vV)),1.5),str=.6+.4*fb(vec3(vU.x*10.,vS,t*.15)),hot=clamp(vB-.6,0.,1.);
    vec3 col=mix(c,vec3(1.,.95,.85),.35*hot)*(1.+1.8*hot*pow(vY,6.));                          /* fresh loops: whiter, bright top */
    col=col*core*str*vB*.9+vec3(1.,.42,.2)*core*vR*1.3;                                       /* rain: cool blobs condensing at the top, sliding down the legs */
    gl_FragColor=vec4(col*smoothstep(0.,.04,vU.x)*smoothstep(1.,.96,vU.x),1.);}` }));
arcade.visible = false; arcade.frustumCulled = false; G.add(arcade);
const cmeL = makeCme(), CU = cmeL.u; G.add(cmeL.group);
const CM = { h: 0, v: 0, prev: 0, d: new THREE.Vector3(), x: new THREE.Vector3(1, 0, 0) }, _mb = new THREE.Matrix4();
function cmeTick(dt, a, rH) { if (a < 1.5 || !rope.userData.cme) { cmeL.group.visible = false; return; }
  if (CM.h < 1.2) { CM.v = Math.min(2.5, Math.max(CM.v, (rH - CM.prev) / Math.max(dt, 1e-3))); CM.h = Math.max(CM.h, rH); } else CM.h += CM.v * dt;   // then it coasts out
  CM.prev = rH; const F = 1 + CM.h * 1.25; cmeL.group.visible = F > 1.3 && F < 31;   // front distance from the Sun's centre
  cmeL.group.scale.setScalar(F); { const x = CM.x.clone().addScaledVector(CM.d, -CM.x.dot(CM.d)).normalize(); cmeL.group.quaternion.setFromRotationMatrix(_mb.makeBasis(x, CM.d, x.clone().cross(CM.d))); }   // the rope leaves lying as it lay on the Sun
  cmeL.set(.45, .55 * THREE.MathUtils.smoothstep(F, 1.3, 2.4) / (1 + .02 * (F - 1) * (F - 1)), U.t.value); }
function flare(big = true, force = null) { const low = camL.length() < 2.5, vr = low && !force ? viewRegion() : null;
  const r = force ? force : low ? vr || { m: [], d: viewPoint(), an: Math.random() * 6.28, k: 1 } : limbRegion(), d = r.d ? r.d.clone() : sph(r.la, r.lo, 1).normalize(), ax = new THREE.Vector3().randomDirection().cross(d).normalize();
  U.fl.value.set(d.x, d.y, d.z, 1.2); U.fa.value.set(ax.x, ax.y, ax.z, 0); if (FL) return; FL = { r, age: 0, d }; fxStart(d);
  if (big) { jet.visible = flash.visible = false; ropeStart(d, r.an, r.k || 1); U.fl.value.w = 0; } for (const m of r.m) m.uniforms.b.value = 3.5; }
function viewPoint() {   // the surface point in the middle of the view (or under the camera)
  const o = camL, f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(_q)).applyQuaternion(G.getWorldQuaternion(new THREE.Quaternion()).invert()),
    b = o.dot(f), h = b * b - o.lengthSq() + 1;
  return h > 0 ? o.clone().addScaledVector(f, -b - Math.sqrt(h)).normalize() : o.clone().normalize(); }
let nf = 6;
function update(dt, c) { cam = c; U.t.value += dt; G.updateMatrixWorld();
  const sc = G.getWorldScale(_v).x; G.getWorldPosition(U.ctr.value); LU.us.value = sc;
  halo.position.copy(U.ctr.value); halo.scale.setScalar(sc); c.getWorldQuaternion(halo.quaternion); halo.updateMatrixWorld();
  U.gInv.value.setFromMatrix4(G.matrixWorld).invert();
  camL.copy(c.getWorldPosition(_v)).applyMatrix4(_m.copy(G.matrixWorld).invert()); U.camL.value.copy(camL);
  qFl.copy(G.getWorldQuaternion(_q)).invert().multiply(halo.quaternion);   // the flash card faces the camera from inside the turning Sun
  U.near.value = 1 - THREE.MathUtils.smoothstep(camL.length(), 1.15, 2.4);   // the close-up look fades in below ~2.4 radii
  for (const l of LIFE) l.life.value = .25 + .75 * Math.pow(Math.max(0, Math.sin(U.t.value * 6.283 / l.per + l.ph)), .6);
  U.fl.value.w *= Math.pow(.35, dt); for (const l of LS) { const u = l.me.material.uniforms.b; u.value += (1 - u.value) * Math.min(1, dt * .6); }
  fxTick(dt);
  if (FL) { FL.age += dt; U.fa.value.w = FL.age; const k = Math.min(1, FL.age / 7);   // the eruption breaks the loops above it over ~7 s
    for (const m of FL.r.m) m.uniforms.brk.value = k;
    if (k >= 1) { for (const m of FL.r.m) { m.uniforms.brk.value = 0; m.uniforms.b.value = 0; } FL = null; } }   // then they grow back from nothing
  if (api.auto) { nf -= dt; if (nf < 0) { flare(Math.random() < .6); nf = 14 + Math.random() * 14; } } }
function ropeAxis(d) {   // which way a flux rope erupting from direction d lies: along the polarity line of the region there (as ropeStart lays it),
  const n = d.clone().normalize(); let best = null, bd = .25; for (const r of REG) { const a = sph(r.la, r.lo, 1).angleTo(n); if (a < bd) { bd = a; best = r; } }   // else the usual tilt for that hemisphere
  if (best) { const C = sph(best.la, best.lo, 1); return around(C, best.an + Math.PI / 2 - .35, .1).sub(around(C, best.an - Math.PI / 2 - .35, .1)).normalize(); }
  const E = new THREE.Vector3(0, 1, 0).cross(n).normalize(), N = n.clone().cross(E), la = Math.asin(Math.max(-1, Math.min(1, n.y)));
  return N.multiplyScalar(Math.cos(la * .5 + .35)).addScaledVector(E, Math.sin(la * .5 + .35)).normalize(); }
function flareAt(d) {   // a measured CME left from direction d (Sun-local): erupt from the region there, or from that spot
  const n = d.clone().normalize(); let best = null, bd = .25; for (const r of REG) { const a = sph(r.la, r.lo, 1).angleTo(n); if (a < bd) { bd = a; best = r; } }
  flare(true, best || { m: [], d: n, an: Math.random() * 6.28, k: 1.2 }); }
const api = { group: G, halo, update, flare: big => cam && flare(big), flareAt: d => cam && flareAt(d), ropeAxis, setFilter, setColor, REG, sph, FM, auto, get filter() { return U.fm.value; }, get color() { return pal; } };
return api; }
