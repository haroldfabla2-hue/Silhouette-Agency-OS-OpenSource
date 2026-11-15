import { chronos } from '../services/chronosService';

const context = chronos.getContext();
console.log('Chronos Context NOW:', context.now);
console.log('Chronos Context TIMESTAMP:', context.timestamp);
console.log('Chronos Context TIMEZONE:', context.timezone);
console.log('Chronos Context DAY:', context.dayOfWeek);
console.log('Chronos Context WEEK:', context.weekNumber);

const systemNow = new Date();
console.log('System NOW (Local):', systemNow.toLocaleString());
