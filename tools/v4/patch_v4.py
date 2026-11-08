#!/usr/bin/env python3
"""v4 patch: 6 new glTF vehicles, 6-wheel visuals, alpha materials, garage hook for the vehicle-select screen.

usage: python3 patch_v4.py <v3/game.js> <out/game.js>   (reads vehicles_v4.js next to this script)
"""
import os
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf8').read()

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f'expected {count} of {old[:80]!r}, found {n}'
    s = s.replace(old, new)

# 1. honour glTF alpha modes (BLEND / MASK) on loaded model materials
rep('side:v.doubleSided?Zt:0}',
    'side:v.doubleSided?Zt:0,transparent:v.alpha==="BLEND",opacity:v.alpha==="BLEND"?v.color[3]:1,'
    'alphaTest:v.alpha==="MASK"?v.alphaCutoff:0,depthWrite:v.alpha!=="BLEND"}')

# 2. extra (visual-only) wheels for 6-wheelers: json wheels[4..]; they follow the same-side front/rear wheels
rep('let f=[0,1,2,3].map(()=>({spin:new jt,fix:new jt}));',
    'let f=a.wheels.map(()=>({spin:new jt,fix:new jt}));')
rep('M.push({steerG:E,spinG:f[v].spin,x:y,z:A})}',
    'M.push({steerG:E,spinG:f[v].spin,x:y,z:A})}'
    'for(let v=4;v<a.wheels.length;v++){let w=a.wheels[v],E=new jt,s0=M[w.x<0?0:1],s1=M[w.x<0?2:3],'
    'tt=(w.z-s1.z)/(s0.z-s1.z),sp=f[v].spin,uw=E.updateMatrixWorld;E.position.set(w.x,i.wy+(w.y-d.y),w.z),g.add(E),'
    'E.add(sp),E.add(f[v].fix),E.updateMatrixWorld=function(F){this.position.y=s1.steerG.position.y+'
    '(s0.steerG.position.y-s1.steerG.position.y)*tt+(w.y-d.y);sp.rotation.x=s1.spinG.rotation.x;return uw.call(this,F)}}')

# 3. new vehicle specs
NEW = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vehicles_v4.js'), encoding='utf8').read().strip().rstrip(',')
rep('},hr=["ridge","trailhound","pickup","crawler","trophy","monster","mule","milk","concept"]',
    ',' + NEW + '},hr=["ridge","trailhound","pickup","crawler","trophy","monster","mule","jeep","cougar",'
    '"challenger","supra","mclaren","milk","concept","rover"]')

# categories for the select screen
rep(',Gt=Bi.ridge;function wS(e)',
    ',Gt=Bi.ridge;Object.entries({ridge:"Off-road",trailhound:"Off-road",crawler:"Off-road",mule:"Off-road",jeep:"Off-road",'
    'pickup:"Trucks",trophy:"Trucks",monster:"Trucks",cougar:"Trucks",milk:"Trucks",concept:"Road & race",challenger:"Road & race",'
    'supra:"Road & race",mclaren:"Road & race",rover:"Specials"}).forEach(([k,c])=>Bi[k]&&(Bi[k].cat=c));function wS(e)')

# 4. per-vehicle off-road rating tweak
rep('(e.id==="concept"?-.3:0)', '(e.id==="concept"?-.3:e.offAdj||0)')

# 5. garage hook used by vehicle-select.js
rep('function Vt(){let I=Bi[hr[H]];', 'function Vt(){let I=Bi[hr[H]];window.__rrGarageUpd&&window.__rrGarageUpd();')
rep('ke("btnGarage").onclick=De,',
    'window.__rrGarage={list:hr,specs:Bi,stats:wS,idx:()=>H,cur:()=>Gt.id,busy:()=>ut,open:De,'
    'go:k=>{H=k,Vt(),Ke(hr[k])}};ke("btnGarage").onclick=De,')

rep('W=Ui.get("rr3_paint_"+D,Ui.get("rr2_paint",is[0]))','W=Ui.get("rr3_paint_"+D,(Bi[D].colors||[Ui.get("rr2_paint",is[0])])[0])')
open(dst, 'w', encoding='utf8').write(s)
print('patched OK', len(s))
