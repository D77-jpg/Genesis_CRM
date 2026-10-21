import * as React from 'react';
import {apiGet,toErrorMessage} from '@/lib/api';
import {useProjectStore} from '@/store/project.store';
import {useAuthStore} from '@/store/auth.store';
import type {DevelopmentLetter,Paginated} from '@/types';

/** 草稿列表的两种视图：待处理（含审核通过待发）/ 已标记不通过 */
export type DraftFeedView='todo'|'rejected';

// Saved letters are the source of truth: old/manual drafts need no Agent task.
export function usePendingDrafts(customerId?:string,enabled=true){
 const projectId=useProjectStore(s=>s.activeProject?.id);
 const userId=useAuthStore(s=>s.user?.id);
 const scopeKey=[projectId,userId,customerId??'all'].join(':');
 const [selection,setSelection]=React.useState({scopeKey,page:1});
 const page=selection.scopeKey===scopeKey?selection.page:1;
 const [view,setViewState]=React.useState<DraftFeedView>('todo');
 const setView=(value:DraftFeedView)=>{setViewState(value);setSelection({scopeKey,page:1});};
 const [revision,setRevision]=React.useState(0);
 const refresh=React.useCallback(()=>setRevision(n=>n+1),[]);
 const setPage=(value:number)=>setSelection({scopeKey,page:value});
 const [state,setState]=React.useState<{key:string;data:Paginated<DevelopmentLetter>|null;loading:boolean;error:string}>({key:'',data:null,loading:true,error:''});
 const key=[scopeKey,page,view].join(':');
 React.useEffect(()=>{
  if(!enabled||!projectId||!userId)return;
  let active=true,timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   setState(previous=>({key,data:previous.key===key?previous.data:null,loading:true,error:''}));
   try{
    const data=await apiGet<Paginated<DevelopmentLetter>>('/letters',{params:{status:'draft',customerId,page,limit:5,sortBy:'createdAt',sortOrder:'desc',review:view}});
    if(active){
     if(page>1&&page>data.totalPages){setSelection({scopeKey,page:Math.max(1,data.totalPages)});return;}
     setState({key,data,loading:false,error:''});
    }
   }catch(error){if(active)setState(previous=>({key,data:previous.key===key?previous.data:null,loading:false,error:toErrorMessage(error,'开发信草稿加载失败')}));}
   if(active)timer=setTimeout(()=>{if(document.visibilityState==='visible')void poll();else timer=setTimeout(refresh,10000);},10000);
  };
  void poll();window.addEventListener('focus',refresh);
  return()=>{active=false;clearTimeout(timer);window.removeEventListener('focus',refresh);};
 },[customerId,enabled,key,page,projectId,refresh,revision,scopeKey,userId,view]);
 const current=state.key===key&&enabled?state:null;
 return {items:current?.data?.items??[],total:current?.data?.total??0,totalPages:current?.data?.totalPages??0,page,setPage,view,setView,refresh,loading:current?.loading??true,error:current?.error??'',customerId};
}
export type PendingDraftFeed=ReturnType<typeof usePendingDrafts>;
