export interface RandomSourceState{seed:number;state:number;nextRandomSeq:number}
export interface RandomResult<T>{value:T;source:RandomSourceState}
const normalize=(value:number)=>value>>>0||0x9e3779b9;
export const createRandomSource=(seed:number):RandomSourceState=>({seed:seed>>>0,state:normalize(seed),nextRandomSeq:1});
function nextUint(source:RandomSourceState):RandomResult<number>{let state=source.state;state^=state<<13;state^=state>>>17;state^=state<<5;state>>>=0;return{value:state,source:{...source,state,nextRandomSeq:source.nextRandomSeq+1}};}
export function shuffleWithSource<T>(items:readonly T[],source:RandomSourceState):RandomResult<T[]>{const value=[...items];let current=source;for(let index=value.length-1;index>0;index--){const next=nextUint(current);current=next.source;const target=next.value%(index+1);[value[index],value[target]]=[value[target]!,value[index]!];}return{value,source:current};}
export function chooseWithSource<T>(items:readonly T[],source:RandomSourceState):RandomResult<T>{if(!items.length)throw new Error("RANDOM_CANDIDATES_EMPTY");const next=nextUint(source);return{value:items[next.value%items.length]!,source:next.source};}
