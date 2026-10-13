// 전체 응답 건수와 실제 item 수를 대조해 부분 월 자료의 저장을 막는다.
export async function fetchAllRtmsPages(fetchPage){
 const texts=[];let count=0,total=null,pageSize=2000;
 for(let page=1;page<=1000;page++){
  const result=await fetchPage(page,pageSize);if(result.failed)return result;
  const text=result.text,n=(text.match(/<item(?:\s[^>]*)?>/g)||[]).length;
  const declared=text.match(/<totalCount>\s*(\d+)\s*<\/totalCount>/);
  if(declared){const value=Number(declared[1]);if(total!==null&&total!==value)return {failed:true,text:'',info:'totalCount changed during pagination'};total=value;}
  const actualPage=text.match(/<pageNo>\s*(\d+)\s*<\/pageNo>/);if(actualPage&&Number(actualPage[1])!==page)return {failed:true,text:'',info:'unexpected pageNo'};
  const reported=text.match(/<numOfRows>\s*(\d+)\s*<\/numOfRows>/);if(page===1&&reported&&Number(reported[1])>0)pageSize=Number(reported[1]);
  texts.push(text);count+=n;
  if(total===null)return {failed:true,text:'',info:'missing totalCount'};
  if(count===total)return {failed:false,text:texts.join('\n'),totalCount:total,collectedCount:count};
  if(count>total||n===0)return {failed:true,text:'',info:'incomplete month response'};
 }
 return {failed:true,text:'',info:'pagination limit'};
}
