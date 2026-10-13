// 북쪽 위·서쪽 왼쪽의 지리 격자. 행정구역 경계·거리를 축척으로 표현하지 않는다.
export const REGIONAL_LAYOUT={
 서울:[
 [null,null,null,null,'도봉구','노원구',null],
 [null,'은평구',null,'강북구','성북구','중랑구',null],
 ['강서구','마포구','서대문구','종로구','중구','동대문구',null],
 ['양천구','영등포구',null,'용산구','성동구','광진구','강동구'],
 ['구로구','금천구','관악구','동작구','서초구','강남구','송파구']],
 경기:[
 [null,null,null,'연천군',null,null,null],
 [null,null,null,'동두천시','포천시',null,null],
 [null,'파주시',null,'양주시','의정부시',null,'가평군'],
 ['김포시','고양 일산서구','고양 일산동구','고양 덕양구',null,'남양주시',null],
 ['부천 오정구',null,null,null,'구리시','하남시','양평군'],
 ['부천 원미구','부천 소사구','광명시','과천시','성남 수정구','성남 중원구',null],
 ['시흥시','안양 만안구','안양 동안구','의왕시','성남 분당구','광주시',null],
 ['안산 단원구','안산 상록구','군포시','수원 장안구','용인 수지구','용인 기흥구','여주시'],
 [null,'화성 효행구','수원 권선구','수원 팔달구','수원 영통구','용인 처인구','이천시'],
 [null,'화성 만세구',null,'화성 병점구','화성 동탄구',null,null],
 [null,null,null,'오산시',null,null,null],
 [null,null,'평택시',null,'안성시',null,null]],
 인천:[
 ['강화군','영종구','제물포구','서해구','검단구','부평구','계양구'],
 [null,null,'연수구','미추홀구','남동구',null,null]],
 부산:[
 ['강서구','북구','사상구','부산진구','금정구','동래구','기장군'],
 ['사하구','서구','중구','동구','연제구','수영구','해운대구'],
 [null,null,null,'영도구','남구',null,null]]
};
// 같은 줄의 빈칸을 인접 지역에 나눠 붙인다. 지리 순서는 유지한다.
export function compactRegionRow(row){
 const points=row.map((name,column)=>({name,column})).filter(x=>x.name);
 return points.map((point,i)=>{const start=i?Math.floor((points[i-1].column+point.column)/2)+1:0;const end=i===points.length-1?row.length:Math.floor((point.column+points[i+1].column)/2)+1;return {name:point.name,start:start+1,span:end-start};});
}
