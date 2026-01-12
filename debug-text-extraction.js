// Debug script to test text extraction
const { E2ETestHarnessImpl } = require('./tests/e2e/framework/harness.js');

async function testTextExtraction() {
  const harness = new E2ETestHarnessImpl();
  
  // Test the extraction function with sample blessed output
  const sampleOutput = `I - Emotional Intelligenceqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxbeta|[ei]xmqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqjlqChat:eiqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkx[7:03 AM]You:Somuchstuff,Ei.Butthistimeit'sfixingupthedebugxxinterfacesothatitdoesn'tdestroytheentireapp.Thismessageshouldbesafexx:Dxxxx[7:03 AM]Ei:Soundslikeyou'retighteningthesafetynetonthedebugconsole—nixxcemove.`;
  
  const cleanText = harness.extractReadableText(sampleOutput);
  
  console.log('Original output:');
  console.log(sampleOutput);
  console.log('\nCleaned text:');
  console.log(cleanText);
  console.log('\nLooking for: "Starting very slow background processing"');
  console.log('Contains text:', cleanText.includes('Starting very slow background processing'));
}

testTextExtraction().catch(console.error);