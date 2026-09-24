'use strict';
/* Génération et vérification des grilles, exécutées côté serveur uniquement :
   la solution n'est jamais envoyée aux navigateurs. */
const crypto = require('crypto');
const rnd = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const DIFFS = {
  facile:{label:"Facile",clues:38,level:1},
  moyen:{label:"Moyen",clues:31,level:1},
  difficile:{label:"Difficile",clues:27,level:2},
  expert:{label:"Expert",clues:24,level:3}
};
const R=[],C=[],B=[],PEERS=[];
for(let i=0;i<81;i++){R[i]=i/9|0;C[i]=i%9;B[i]=(R[i]/3|0)*3+(C[i]/3|0)}
for(let i=0;i<81;i++){const s=new Set();for(let j=0;j<81;j++)if(j!==i&&(R[j]===R[i]||C[j]===C[i]||B[j]===B[i]))s.add(j);PEERS[i]=[...s]}

/* ---------- Générateur ---------- */
const pop=m=>{let c=0;while(m){m&=m-1;c++}return c};
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=rnd()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a}
function search(g,limit,random){
  const rows=new Uint16Array(9),cols=new Uint16Array(9),boxes=new Uint16Array(9);
  for(let i=0;i<81;i++){const v=g[i];if(v){const m=1<<v;rows[R[i]]|=m;cols[C[i]]|=m;boxes[B[i]]|=m}}
  let count=0;
  (function rec(){
    let best=-1,mask=0,bn=10;
    for(let i=0;i<81;i++)if(!g[i]){const av=~(rows[R[i]]|cols[C[i]]|boxes[B[i]])&0x3FE;const n=pop(av);if(!n)return;if(n<bn){bn=n;best=i;mask=av;if(n===1)break}}
    if(best<0){count++;return}
    let vs=[];for(let v=1;v<=9;v++)if(mask&(1<<v))vs.push(v);
    if(random)shuffle(vs);
    for(const v of vs){const m=1<<v;g[best]=v;rows[R[best]]|=m;cols[C[best]]|=m;boxes[B[best]]|=m;
      rec();if(count>=limit)return;
      rows[R[best]]&=~m;cols[C[best]]&=~m;boxes[B[best]]&=~m;g[best]=0}
  })();
  return count;
}
/* Solveur « humain » : n'utilise que des déductions logiques, jamais d'essai-erreur.
   Niveau 1 : singletons nus et cachés. Niveau 2 : + candidats verrouillés, paires nues et cachées.
   Niveau 3 : + triplets nus, X-Wing. Une grille qu'il termine a forcément une solution unique. */
const UNITS=[];
for(let k=0;k<9;k++){UNITS.push([...Array(9)].map((_,j)=>k*9+j));UNITS.push([...Array(9)].map((_,j)=>j*9+k))}
for(let b=0;b<9;b++){const r0=(b/3|0)*3,c0=(b%3)*3;UNITS.push([...Array(9)].map((_,j)=>(r0+(j/3|0))*9+c0+j%3))}
function logicSolve(p,level){
  const g=p.slice(),cand=new Array(81).fill(0);
  for(let i=0;i<81;i++)if(!g[i]){let m=0x1FF;for(const j of PEERS[i])if(g[j])m&=~(1<<(g[j]-1));cand[i]=m}
  const place=(i,v)=>{g[i]=v;cand[i]=0;const b=~(1<<(v-1));for(const j of PEERS[i])cand[j]&=b};
  const elim=(i,m)=>{if(!g[i]&&(cand[i]&m)){cand[i]&=~m;return true}return false};
  for(let guard=0;guard<500;guard++){
    let prog=false;
    for(let i=0;i<81;i++)if(!g[i]){if(!cand[i])return false;if(pop(cand[i])===1){place(i,31-Math.clz32(cand[i])+1);prog=true}}
    if(prog)continue;
    for(const u of UNITS)for(let v=1;v<=9;v++){
      const b=1<<(v-1);let n=0,at=-1,has=false;
      for(const i of u){if(g[i]===v)has=true;else if(cand[i]&b){n++;at=i}}
      if(has)continue;if(!n)return false;if(n===1){place(at,v);prog=true}
    }
    if(prog)continue;
    if(g.every(x=>x))return true;
    if(level<2)return false;
    // candidats verrouillés (pointage + réduction ligne/bloc)
    for(let u1=0;u1<27&&!prog;u1++)for(let v=1;v<=9&&!prog;v++){
      const b=1<<(v-1);const cells=UNITS[u1].filter(i=>cand[i]&b);if(cells.length<2)continue;
      for(let u2=0;u2<27;u2++){if(u2===u1)continue;const U2=UNITS[u2];
        if(cells.every(i=>U2.includes(i)))for(const j of U2)if(!cells.includes(j)&&elim(j,b))prog=true}
    }
    if(prog)continue;
    // paires nues
    for(const u of UNITS){const pr=u.filter(i=>pop(cand[i])===2);
      for(let a=0;a<pr.length;a++)for(let c=a+1;c<pr.length;c++)if(cand[pr[a]]===cand[pr[c]]){const m=cand[pr[a]];for(const j of u)if(j!==pr[a]&&j!==pr[c]&&elim(j,m))prog=true}}
    if(prog)continue;
    // paires cachées
    for(const u of UNITS)for(let v1=1;v1<9;v1++)for(let v2=v1+1;v2<=9;v2++){
      const b1=1<<(v1-1),b2=1<<(v2-1);const c1=u.filter(i=>cand[i]&b1),c2=u.filter(i=>cand[i]&b2);
      if(c1.length===2&&c2.length===2&&c1[0]===c2[0]&&c1[1]===c2[1])for(const i of c1)if(cand[i]&~(b1|b2)){cand[i]&=(b1|b2);prog=true}
    }
    if(prog)continue;
    if(level<3)return false;
    // triplets nus
    for(const u of UNITS){const t=u.filter(i=>{const n=pop(cand[i]);return n===2||n===3});
      for(let a=0;a<t.length;a++)for(let b=a+1;b<t.length;b++)for(let c=b+1;c<t.length;c++){
        const m=cand[t[a]]|cand[t[b]]|cand[t[c]];if(pop(m)!==3)continue;
        for(const j of u)if(j!==t[a]&&j!==t[b]&&j!==t[c]&&elim(j,m))prog=true}}
    if(prog)continue;
    // X-Wing (lignes puis colonnes)
    for(let v=1;v<=9&&!prog;v++){const b=1<<(v-1);
      for(const byRow of [true,false]){
        const at=k=>[...Array(9).keys()].filter(j=>cand[byRow?k*9+j:j*9+k]&b);
        for(let k1=0;k1<9;k1++){const a1=at(k1);if(a1.length!==2)continue;
          for(let k2=k1+1;k2<9;k2++){const a2=at(k2);if(a2.length!==2||a2[0]!==a1[0]||a2[1]!==a1[1])continue;
            for(let k=0;k<9;k++)if(k!==k1&&k!==k2)for(const j of a1)if(elim(byRow?k*9+j:j*9+k,b))prog=true}}
      }
    }
    if(!prog)return false;
  }
  return false;
}
function validSolution(sol){
  if(sol.length!==81||sol.some(v=>v<1||v>9))return false;
  return UNITS.every(u=>new Set(u.map(i=>sol[i])).size===9);
}
function validateGrid(puzzle,solution){
  const p=[...puzzle].map(Number),sol=[...solution].map(Number);
  if(!validSolution(sol))return false;
  for(let i=0;i<81;i++)if(p[i]&&p[i]!==sol[i])return false;
  const g=p.slice();if(search(g,2,false)!==1)return false;            // solution unique
  const full=p.slice();search(full,1,false);if(full.join("")!==solution)return false;
  return logicSolve(p,3)===true;                                       // résoluble sans deviner
}
function generateOnce(diff){
  const {clues:target,level}=DIFFS[diff];
  const sol=new Array(81).fill(0);search(sol,1,true);
  const p=sol.slice();let clues=81;
  for(const i of shuffle([...Array(81).keys()])){
    if(clues<=target)break;
    const v=p[i];p[i]=0;
    if(logicSolve(p,level))clues--;else p[i]=v;
  }
  return {puzzle:p.join(""),solution:sol.join(""),clues};
}
function generate(diff){
  let best=null;
  for(let t=0;t<30;t++){
    const r=generateOnce(diff);
    if(!validateGrid(r.puzzle,r.solution))continue;
    if(!best||r.clues<best.clues)best=r;
    if(r.clues<=DIFFS[diff].clues)break;
  }
  return best;
}


module.exports = { DIFFS, PEERS, generate, validateGrid, logicSolve };
