import type { SelectionSpec } from "@skb-protocol/client-protocol";
export type SelectionValue=string|number|boolean;
export type SelectionState=Record<string,SelectionValue[]>;
export function toggleSelection(state:SelectionState,spec:SelectionSpec,value:SelectionValue):SelectionState{const current=state[spec.key]??[];const next=current.includes(value)?current.filter(item=>item!==value):spec.max===1?[value]:[...current,value].slice(-spec.max);return {...state,[spec.key]:next};}
export function selectionsComplete(specs:readonly SelectionSpec[],state:SelectionState):boolean{return specs.every(spec=>{const values=state[spec.key]??[];return values.length>=spec.min&&values.length<=spec.max&&(!spec.distinct||new Set(values).size===values.length)&&(!spec.options||values.every(value=>spec.options?.includes(value)));});}
