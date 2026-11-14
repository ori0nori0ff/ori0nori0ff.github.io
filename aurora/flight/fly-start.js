/* fly.html loader: ?craft=orbiter -> the S1 orbit test (flight/orbit-test.js); ?craft=rocket -> the S5 rocket test (flight/rocket-test.js);
   otherwise the S0c / S2 aircraft test (flight/fly-test.js) */
const craft = new URLSearchParams(location.search).get('craft');
await import(craft === 'orbiter' ? './orbit-test.js' : craft === 'rocket' ? './rocket-test.js' : './fly-test.js');
