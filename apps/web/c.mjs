const hex=h=>{h=h.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255)}
const lin=c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4)
const L=h=>{const[r,g,b]=hex(h).map(lin);return 0.2126*r+0.7152*g+0.0722*b}
const ratio=(a,b)=>{const l1=L(a),l2=L(b);const[hi,lo]=l1>l2?[l1,l2]:[l2,l1];return (hi+0.05)/(lo+0.05)}
const over=(fg,alpha,bg)=>{const f=hex(fg),b=hex(bg);const m=f.map((c,i)=>c*alpha+b[i]*(1-alpha));return '#'+m.map(c=>Math.round(c*255).toString(16).padStart(2,'0')).join('')}
const W='#FFFFFF', S='#F7F7F5', D='#151515'
const p=(n,a,b)=>console.log(n.padEnd(34), a.padEnd(9), 'on', b.padEnd(9), ratio(a,b).toFixed(2))
console.log('--- text ramp on white / #F7F7F5 ---')
for(const [n,c] of [['ink #151515','#151515'],['ink-2 #4A4A48','#4A4A48'],['ink-2 #55554F','#55554F'],['secondary #6F6F6F','#6F6F6F'],['muted #A5A5A5','#A5A5A5'],['muted #8A8A85','#8A8A85']]) { p(n,c,W); p(n,c,S) }
console.log('--- accent candidates: as text on white, and white text on it ---')
for(const c of ['#2547FF','#1F4FE0','#2B5BD7','#1D4ED8','#0F4CE0','#3355EE','#1a3fd4','#2038B8','#3A3AFF']) { p('text on white',c,W); p('WHITE on fill','#FFFFFF',c); p('ink on fill',D,c); console.log('') }
console.log('--- semantic on white ---')
for(const [n,c] of [['verdigris #0E8F63','#0E8F63'],['verdigris #0F7B57','#0F7B57'],['saffron #A2650A','#A2650A'],['saffron #8A5400','#8A5400'],['oxide #C6382C','#C6382C'],['oxide #B3271B','#B3271B'],['steel #6B3FD4','#6B3FD4'],['steel #5B34C7','#5B34C7']]) { p(n,c,W); p(n,c,S) }
console.log('--- soft washes: colored text on its own 12% wash over white ---')
for(const [n,c] of [['brass','#1F4FE0'],['verdigris','#0E8F63'],['saffron','#A2650A'],['oxide','#C6382C'],['steel','#6B3FD4']]) { const w=over(c,0.12,W); p(n+' on wash '+w, c, w) }
console.log('--- dark surface #151515: light text ---')
for(const c of ['#FFFFFF','#EDEDEB','#B5B5B0','#A5A5A5','#8F8F8A']) p('on dark',c,D)
console.log('--- accent on dark #151515 ---')
for(const c of ['#7FA0FF','#8FA8FF','#6E92FF','#5C86FF']) p('accent on dark',c,D)
