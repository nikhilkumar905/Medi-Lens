import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { HeartPulse, Languages, Loader2, Mic } from 'lucide-react'
import { api, auth } from './services/api'

export type Lang = 'en' | 'hi' | 'te'
type Other = Exclude<Lang, 'en'>

export const LANGS: { code: Lang; label: string; native: string; speech: string; hello: string; sub: string }[] = [
  { code: 'en', label: 'English', native: 'English', speech: 'en-IN', hello: 'Hello!', sub: 'Continue in English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', speech: 'hi-IN', hello: 'नमस्ते!', sub: 'हिन्दी में जारी रखें' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు', speech: 'te-IN', hello: 'నమస్కారం!', sub: 'తెలుగులో కొనసాగించండి' },
]

/** Text already written in the target script needs no translation. */
export const isNative = (text: string, lang: Lang) =>
  lang === 'en' || (lang === 'hi' ? /[ऀ-ॿ]/ : /[ఀ-౿]/).test(text)

/**
 * Hand-checked translations for the most visible UI text and the assistant's fixed prompts.
 * Anything missing is translated once by the backend and cached in this browser (see `lookup`).
 */
const DICT: Record<string, { hi: string; te: string }> = {
  // ----- language picker / login (shown before sign-in, so they must be here) -----
  'Choose your language': { hi: 'अपनी भाषा चुनें', te: 'మీ భాషను ఎంచుకోండి' },
  'The screens, the voice assistant and your results will use this language. You can change it any time from the top bar.': {
    hi: 'स्क्रीन, वॉइस असिस्टेंट और आपके नतीजे इसी भाषा में होंगे। आप इसे ऊपर की पट्टी से कभी भी बदल सकते हैं।',
    te: 'స్క్రీన్‌లు, వాయిస్ అసిస్టెంట్ మరియు మీ ఫలితాలు ఈ భాషలో ఉంటాయి. పై బార్ నుండి ఎప్పుడైనా మార్చవచ్చు.',
  },
  'Your browser has no voice for this language, so replies will be shown as text.': {
    hi: 'आपके ब्राउज़र में इस भाषा की आवाज़ नहीं है, इसलिए जवाब लिखकर दिखाए जाएँगे।',
    te: 'మీ బ్రౌజర్‌లో ఈ భాష వాయిస్ లేదు, కాబట్టి సమాధానాలు అక్షరాల్లో చూపబడతాయి.',
  },
  'Voice-first medical assistant': { hi: 'आवाज़ से चलने वाला मेडिकल असिस्टेंट', te: 'వాయిస్‌తో పనిచేసే వైద్య సహాయకుడు' },
  Username: { hi: 'यूज़रनेम', te: 'యూజర్‌నేమ్' },
  Password: { hi: 'पासवर्ड', te: 'పాస్‌వర్డ్' },
  'Sign in': { hi: 'साइन इन करें', te: 'సైన్ ఇన్ చేయండి' },
  'Decision-support tool. Not a certified medical device. Use synthetic data unless your hospital has approved this environment.': {
    hi: 'यह निर्णय में सहायता करने वाला टूल है, प्रमाणित मेडिकल उपकरण नहीं। जब तक आपका अस्पताल अनुमति न दे, नकली (सिंथेटिक) डेटा ही इस्तेमाल करें।',
    te: 'ఇది నిర్ణయాలకు సహాయపడే సాధనం, ధృవీకరించబడిన వైద్య పరికరం కాదు. మీ ఆసుపత్రి అనుమతించే వరకు కృత్రిమ (సింథటిక్) డేటానే వాడండి.',
  },

  // ----- header / voice panel -----
  'Your voice health assistant': { hi: 'आपका वॉइस हेल्थ असिस्टेंट', te: 'మీ వాయిస్ ఆరోగ్య సహాయకుడు' },
  Ready: { hi: 'तैयार', te: 'సిద్ధం' },
  'Assistant not set up': { hi: 'असिस्टेंट सेट नहीं है', te: 'అసిస్టెంట్ సెటప్ కాలేదు' },
  'Server offline': { hi: 'सर्वर बंद है', te: 'సర్వర్ ఆఫ్‌లైన్' },
  Advanced: { hi: 'एडवांस्ड', te: 'అడ్వాన్స్‌డ్' },
  'Try saying': { hi: 'ऐसे बोलकर देखें', te: 'ఇలా చెప్పి చూడండి' },
  '…or type here': { hi: '…या यहाँ लिखें', te: '…లేదా ఇక్కడ టైప్ చేయండి' },
  'Tap the mic and just talk. I can guide you through every step by voice.': {
    hi: 'माइक दबाइए और बस बोलिए। मैं हर कदम पर आवाज़ से आपकी मदद करूँगा।',
    te: 'మైక్ నొక్కి మాట్లాడండి. ప్రతి దశలో నేను వాయిస్‌తో మీకు దారి చూపిస్తాను.',
  },
  'Tap to talk': { hi: 'बोलने के लिए दबाएँ', te: 'మాట్లాడటానికి నొక్కండి' },
  'Paused: not listening. Tap to resume': { hi: 'रुका हुआ: सुन नहीं रहा। फिर से शुरू करने के लिए दबाएँ', te: 'ఆపబడింది: వినడం లేదు. మళ్ళీ ప్రారంభించడానికి నొక్కండి' },
  "I'm listening…": { hi: 'मैं सुन रहा हूँ…', te: 'నేను వింటున్నాను…' },
  'Hearing you…': { hi: 'आपकी बात सुन रहा हूँ…', te: 'మీ మాట వింటున్నాను…' },
  'Thinking…': { hi: 'सोच रहा हूँ…', te: 'ఆలోచిస్తున్నాను…' },
  'Speaking — tap to stop': { hi: 'बोल रहा हूँ — रोकने के लिए दबाएँ', te: 'మాట్లాడుతున్నాను — ఆపడానికి నొక్కండి' },
  'Microphone unavailable — tap to retry': { hi: 'माइक्रोफ़ोन उपलब्ध नहीं — दोबारा कोशिश के लिए दबाएँ', te: 'మైక్రోఫోన్ అందుబాటులో లేదు — మళ్ళీ ప్రయత్నించడానికి నొక్కండి' },
  'Paused. I won’t listen or speak until you tap the mic again.': {
    hi: 'रोका गया। जब तक आप माइक दोबारा नहीं दबाते, मैं न सुनूँगा न बोलूँगा।',
    te: 'ఆపబడింది. మీరు మళ్ళీ మైక్ నొక్కే వరకు నేను వినను, మాట్లాడను.',
  },

  // ----- guided flow -----
  "Hi, I'm": { hi: 'नमस्ते, मैं हूँ', te: 'నమస్కారం, నేను' },
  'Tap any part of the body to start, or just talk to me.': { hi: 'शुरू करने के लिए शरीर के किसी भी हिस्से पर टैप करें, या बस मुझसे बात करें।', te: 'ప్రారంభించడానికి శరీరంలో ఏ భాగాన్నైనా నొక్కండి, లేదా నాతో మాట్లాడండి.' },
  'Tap the body or say “Hey, I need help” to begin': { hi: 'शुरू करने के लिए शरीर पर टैप करें या बोलें “मुझे मदद चाहिए”', te: 'ప్రారంభించడానికి శరీరంపై నొక్కండి లేదా “నాకు సహాయం కావాలి” అని చెప్పండి' },
  'Good morning!': { hi: 'सुप्रभात!', te: 'శుభోదయం!' },
  'Good afternoon!': { hi: 'नमस्कार!', te: 'నమస్కారం!' },
  'Good evening!': { hi: 'शुभ संध्या!', te: 'శుభ సాయంత్రం!' },
  'You picked the {part}.': { hi: 'आपने {part} चुना।', te: 'మీరు {part} ఎంచుకున్నారు.' },
  'How can I help you?': { hi: 'मैं आपकी क्या मदद करूँ?', te: 'నేను మీకు ఎలా సహాయం చేయగలను?' },
  'You selected the {part}. What would you like to do?': { hi: 'आपने {part} चुना है। आप क्या करना चाहेंगे?', te: 'మీరు {part} ఎంచుకున్నారు. మీరు ఏమి చేయాలనుకుంటున్నారు?' },
  'Tap an option below, or say its number.': { hi: 'नीचे कोई विकल्प दबाएँ, या उसका नंबर बोलें।', te: 'కింద ఒక ఎంపికను నొక్కండి, లేదా దాని సంఖ్య చెప్పండి.' },
  'Option {n}': { hi: 'विकल्प {n}', te: 'ఎంపిక {n}' },
  'Say “{phrase}”': { hi: 'बोलें “{phrase}”', te: '“{phrase}” అని చెప్పండి' },
  'Analyze a medical report': { hi: 'मेडिकल रिपोर्ट की जाँच करें', te: 'మెడికల్ రిపోర్ట్ విశ్లేషించండి' },
  "Upload a file or show it to the camera. I'll explain it simply, with precautions and what to avoid.": {
    hi: 'फ़ाइल अपलोड करें या कैमरे को दिखाएँ। मैं इसे आसान भाषा में समझाऊँगा, सावधानियों और परहेज़ के साथ।',
    te: 'ఫైల్ అప్‌లోడ్ చేయండి లేదా కెమెరాకు చూపించండి. జాగ్రత్తలు, దూరంగా ఉండవలసినవాటితో సహా సులభంగా వివరిస్తాను.',
  },
  'analyze my report': { hi: 'मेरी रिपोर्ट जाँचो', te: 'నా రిపోర్ట్ చూడు' },
  'Ask about a disease or get advice': { hi: 'बीमारी के बारे में पूछें या सलाह लें', te: 'వ్యాధి గురించి అడగండి లేదా సలహా పొందండి' },
  'Symptoms or diseases of the {part}': { hi: '{part} के लक्षण या बीमारियाँ', te: '{part} లక్షణాలు లేదా వ్యాధులు' },
  'Tell me your symptoms for possible conditions, or learn causes, prevention and precautions for any disease.': {
    hi: 'संभावित बीमारियाँ जानने के लिए अपने लक्षण बताएँ, या किसी भी बीमारी के कारण, बचाव और सावधानियाँ जानें।',
    te: 'సంభావ్య వ్యాధుల కోసం మీ లక్షణాలు చెప్పండి, లేదా ఏ వ్యాధికైనా కారణాలు, నివారణ, జాగ్రత్తలు తెలుసుకోండి.',
  },
  'ask about a disease': { hi: 'बीमारी के बारे में पूछो', te: 'వ్యాధి గురించి అడుగు' },
  'Upload a photo of a disease or injury': { hi: 'बीमारी या चोट की फ़ोटो अपलोड करें', te: 'వ్యాధి లేదా గాయం ఫోటో అప్‌లోడ్ చేయండి' },
  "Rash, skin spot, wound, burn, bite or swelling. I'll predict the likely condition, symptoms, causes and precautions.": {
    hi: 'चकत्ते, त्वचा के दाग, घाव, जलन, काटने या सूजन की फ़ोटो। मैं संभावित बीमारी, लक्षण, कारण और सावधानियाँ बताऊँगा।',
    te: 'దద్దుర్లు, చర్మపు మచ్చ, గాయం, కాలిన గాయం, కాటు లేదా వాపు. సంభావ్య వ్యాధి, లక్షణాలు, కారణాలు, జాగ్రత్తలు చెబుతాను.',
  },
  'check a photo': { hi: 'फ़ोटो जाँचो', te: 'ఫోటో చూడు' },
  'How would you like to share the report?': { hi: 'आप रिपोर्ट कैसे देना चाहेंगे?', te: 'రిపోర్ట్‌ను ఎలా పంచుకోవాలనుకుంటున్నారు?' },
  'Upload a file': { hi: 'फ़ाइल अपलोड करें', te: 'ఫైల్ అప్‌లోడ్ చేయండి' },
  'PDF, photo, Word or text. Browse yourself, or tell me where it is.': { hi: 'PDF, फ़ोटो, Word या टेक्स्ट। खुद चुनें, या मुझे बताएँ कि फ़ाइल कहाँ है।', te: 'PDF, ఫోటో, Word లేదా టెక్స్ట్. మీరే ఎంచుకోండి, లేదా అది ఎక్కడ ఉందో చెప్పండి.' },
  'upload a file': { hi: 'फ़ाइल अपलोड करो', te: 'ఫైల్ అప్‌లోడ్ చేయి' },
  'Show it on camera': { hi: 'कैमरे पर दिखाएँ', te: 'కెమెరాలో చూపించండి' },
  'Hold the paper report in front of your webcam or phone camera.': { hi: 'काग़ज़ की रिपोर्ट को वेबकैम या फ़ोन कैमरे के सामने रखें।', te: 'పేపర్ రిపోర్ట్‌ను వెబ్‌క్యామ్ లేదా ఫోన్ కెమెరా ముందు పట్టుకోండి.' },
  'use the camera': { hi: 'कैमरा चालू करो', te: 'కెమెరా వాడు' },
  "What's bothering you?": { hi: 'आपको क्या परेशानी है?', te: 'మీకు ఏమి ఇబ్బందిగా ఉంది?' },
  'Show me the problem': { hi: 'मुझे समस्या दिखाइए', te: 'సమస్యను నాకు చూపించండి' },
  Back: { hi: 'वापस', te: 'వెనక్కి' },
  'How can I help': { hi: 'मैं क्या मदद करूँ', te: 'ఎలా సహాయం చేయాలి' },
  'Analyze report': { hi: 'रिपोर्ट जाँच', te: 'రిపోర్ట్ విశ్లేషణ' },
  'Upload file': { hi: 'फ़ाइल अपलोड', te: 'ఫైల్ అప్‌లోడ్' },
  'Disease & advice': { hi: 'बीमारी और सलाह', te: 'వ్యాధి & సలహా' },
  'Photo of disease / injury': { hi: 'बीमारी / चोट की फ़ोटो', te: 'వ్యాధి / గాయం ఫోటో' },
  'Area: {part}': { hi: 'हिस्सा: {part}', te: 'భాగం: {part}' },
  'Check another photo': { hi: 'दूसरी फ़ोटो जाँचें', te: 'మరో ఫోటో చూడండి' },
  'Ask something else': { hi: 'कुछ और पूछें', te: 'ఇంకేదైనా అడగండి' },
  'Analyze another report': { hi: 'दूसरी रिपोर्ट जाँचें', te: 'మరో రిపోర్ట్ విశ్లేషించండి' },

  // ----- spoken prompts -----
  'How can I help you? Tap an option, or say "one" to analyze a medical report, "two" to ask about a disease, or "three" to check a photo of a disease or injury.': {
    hi: 'मैं आपकी क्या मदद करूँ? कोई विकल्प दबाएँ, या मेडिकल रिपोर्ट जाँचने के लिए "एक", किसी बीमारी के बारे में पूछने के लिए "दो", या बीमारी या चोट की फ़ोटो जाँचने के लिए "तीन" बोलें।',
    te: 'నేను మీకు ఎలా సహాయం చేయగలను? ఒక ఎంపికను నొక్కండి, లేదా మెడికల్ రిపోర్ట్ కోసం "ఒకటి", వ్యాధి గురించి అడగడానికి "రెండు", వ్యాధి లేదా గాయం ఫోటో కోసం "మూడు" అని చెప్పండి.',
  },
  'How can I help you? Say "one" to analyze a medical report, "two" to ask about a disease or your symptoms, or "three" to check a photo of a disease or injury.': {
    hi: 'मैं आपकी क्या मदद करूँ? मेडिकल रिपोर्ट जाँचने के लिए "एक" बोलें, किसी बीमारी या अपने लक्षणों के बारे में पूछने के लिए "दो", या बीमारी या चोट की फ़ोटो जाँचने के लिए "तीन" बोलें।',
    te: 'నేను మీకు ఎలా సహాయం చేయగలను? మెడికల్ రిపోర్ట్ కోసం "ఒకటి", వ్యాధి లేదా మీ లక్షణాల గురించి అడగడానికి "రెండు", వ్యాధి లేదా గాయం ఫోటో కోసం "మూడు" అని చెప్పండి.',
  },
  'Would you like to upload a file, or show the report to the camera?': {
    hi: 'क्या आप फ़ाइल अपलोड करना चाहेंगे, या रिपोर्ट कैमरे को दिखाना चाहेंगे?',
    te: 'మీరు ఫైల్ అప్‌లోడ్ చేయాలనుకుంటున్నారా, లేక రిపోర్ట్‌ను కెమెరాకు చూపిస్తారా?',
  },
  'Drop the file here or click to browse. You can also tell me where it is, like "the CBC report in Downloads".': {
    hi: 'फ़ाइल यहाँ छोड़ें या चुनने के लिए क्लिक करें। आप यह भी बता सकते हैं कि फ़ाइल कहाँ है, जैसे "डाउनलोड्स में CBC रिपोर्ट"।',
    te: 'ఫైల్‌ను ఇక్కడ వదలండి లేదా ఎంచుకోవడానికి క్లిక్ చేయండి. అది ఎక్కడ ఉందో కూడా చెప్పవచ్చు, ఉదా. "డౌన్‌లోడ్స్‌లో CBC రిపోర్ట్".',
  },
  'Tell me your symptoms, or name a disease you want to know about.': {
    hi: 'अपने लक्षण बताइए, या उस बीमारी का नाम बताइए जिसके बारे में आप जानना चाहते हैं।',
    te: 'మీ లక్షణాలు చెప్పండి, లేదా మీరు తెలుసుకోవాలనుకునే వ్యాధి పేరు చెప్పండి.',
  },
  'Upload or take a close-up photo of the skin problem, wound or injury, and I will predict what it might be.': {
    hi: 'त्वचा की समस्या, घाव या चोट की पास से फ़ोटो अपलोड करें या खींचें, और मैं बताऊँगा कि यह क्या हो सकता है।',
    te: 'చర్మ సమస్య, గాయం లేదా దెబ్బ యొక్క దగ్గరి ఫోటోను అప్‌లోడ్ చేయండి లేదా తీయండి, అది ఏమై ఉండవచ్చో నేను అంచనా వేస్తాను.',
  },
  'Back to the start. Tap the body or say "I need help".': { hi: 'शुरुआत पर वापस। शरीर पर टैप करें या बोलें "मुझे मदद चाहिए"।', te: 'మొదటికి తిరిగి వచ్చాం. శరీరంపై నొక్కండి లేదా "నాకు సహాయం కావాలి" అని చెప్పండి.' },
  'Please say yes or no.': { hi: 'कृपया हाँ या नहीं बोलें।', te: 'దయచేసి అవును లేదా కాదు అని చెప్పండి.' },
  'Okay.': { hi: 'ठीक है।', te: 'సరే.' },
  'Cancelled.': { hi: 'रद्द कर दिया।', te: 'రద్దు చేశాను.' },
  'Let me take a close look at the photo.': { hi: 'मैं फ़ोटो को ध्यान से देखता हूँ।', te: 'ఫోటోను జాగ్రత్తగా చూస్తాను.' },
  'Got the photo. Add any notes if you like, then tap Predict condition.': { hi: 'फ़ोटो मिल गई। चाहें तो कुछ जानकारी लिखें, फिर "बीमारी का अनुमान लगाएँ" दबाएँ।', te: 'ఫోటో వచ్చింది. కావాలంటే వివరాలు రాయండి, తర్వాత "వ్యాధిని అంచనా వేయండి" నొక్కండి.' },
  'Point the camera at the affected area in good light, then say "capture" or tap Capture.': { hi: 'अच्छी रोशनी में कैमरा प्रभावित हिस्से की ओर करें, फिर "कैप्चर" बोलें या कैप्चर दबाएँ।', te: 'మంచి వెలుతురులో కెమెరాను ప్రభావిత భాగం వైపు చూపించి, "క్యాప్చర్" అని చెప్పండి లేదా క్యాప్చర్ నొక్కండి.' },
  'Hold the report flat in front of the camera, then say "capture" or tap Capture.': { hi: 'रिपोर्ट को कैमरे के सामने सीधा रखें, फिर "कैप्चर" बोलें या कैप्चर दबाएँ।', te: 'రిపోర్ట్‌ను కెమెరా ముందు సమతలంగా పట్టుకుని, "క్యాప్చర్" అని చెప్పండి లేదా క్యాప్చర్ నొక్కండి.' },

  // ----- assistant acknowledgements that come with an action -----
  'Would you like to upload a file or show the report to the camera?': { hi: 'क्या आप फ़ाइल अपलोड करना चाहेंगे या रिपोर्ट कैमरे को दिखाएँगे?', te: 'ఫైల్ అప్‌లోడ్ చేస్తారా లేక రిపోర్ట్‌ను కెమెరాకు చూపిస్తారా?' },
  'Okay, let me think through those symptoms.': { hi: 'ठीक है, मैं इन लक्षणों पर सोचता हूँ।', te: 'సరే, ఈ లక్షణాల గురించి ఆలోచిస్తాను.' },
  'Sure. Tell me your symptoms, or name a disease you\'d like to know about.': { hi: 'ज़रूर। अपने लक्षण बताइए, या उस बीमारी का नाम बताइए जिसके बारे में जानना चाहते हैं।', te: 'తప్పకుండా. మీ లక్షణాలు చెప్పండి, లేదా తెలుసుకోవాలనుకునే వ్యాధి పేరు చెప్పండి.' },
  'Sure. Upload or take a close-up photo of the problem area.': { hi: 'ज़रूर। समस्या वाले हिस्से की पास से फ़ोटो अपलोड करें या खींचें।', te: 'తప్పకుండా. సమస్య ఉన్న భాగం దగ్గరి ఫోటోను అప్‌లోడ్ చేయండి లేదా తీయండి.' },
  'Drop the file in, or tell me where it is, like the CBC report in Downloads.': { hi: 'फ़ाइल यहाँ डालें, या बताइए कि वह कहाँ है, जैसे डाउनलोड्स में CBC रिपोर्ट।', te: 'ఫైల్‌ను ఇక్కడ వేయండి, లేదా అది ఎక్కడ ఉందో చెప్పండి, ఉదా. డౌన్‌లోడ్స్‌లో CBC రిపోర్ట్.' },
  'Opening the camera. Hold the report steady and say capture.': { hi: 'कैमरा खोल रहा हूँ। रिपोर्ट को स्थिर रखें और "कैप्चर" बोलें।', te: 'కెమెరా తెరుస్తున్నాను. రిపోర్ట్‌ను కదలకుండా పట్టుకుని "క్యాప్చర్" అని చెప్పండి.' },
  'Opening the camera. Please allow camera access if your browser asks.': { hi: 'कैमरा खोल रहा हूँ। ब्राउज़र पूछे तो कैमरे की अनुमति दें।', te: 'కెమెరా తెరుస్తున్నాను. బ్రౌజర్ అడిగితే కెమెరా అనుమతి ఇవ్వండి.' },
  'Back to the start.': { hi: 'शुरुआत पर वापस।', te: 'మొదటికి తిరిగి వచ్చాం.' },
  'Going back.': { hi: 'वापस जा रहा हूँ।', te: 'వెనక్కి వెళ్తున్నాను.' },
  'Reading the findings.': { hi: 'नतीजे पढ़ रहा हूँ।', te: 'ఫలితాలు చదువుతున్నాను.' },
  'Sure, analyzing it now.': { hi: 'ज़रूर, अभी जाँच कर रहा हूँ।', te: 'తప్పకుండా, ఇప్పుడే విశ్లేషిస్తున్నాను.' },
  'Let me look for that file.': { hi: 'मैं वह फ़ाइल ढूँढता हूँ।', te: 'ఆ ఫైల్ కోసం వెతుకుతాను.' },
  'Capturing the image.': { hi: 'फ़ोटो ले रहा हूँ।', te: 'ఫోటో తీస్తున్నాను.' },
  'Do you confirm you want to generate the PDF report?': { hi: 'क्या आप PDF रिपोर्ट बनाना चाहते हैं?', te: 'PDF రిపోర్ట్ తయారు చేయాలా?' },
  'Approve & download report': { hi: 'मंज़ूर करें और रिपोर्ट डाउनलोड करें', te: 'ఆమోదించి రిపోర్ట్ డౌన్‌లోడ్ చేయండి' },
  'Do you approve this analysis and want to download it as a PDF?': { hi: 'क्या आप इस विश्लेषण को मंज़ूर करके PDF के रूप में डाउनलोड करना चाहते हैं?', te: 'ఈ విశ్లేషణను ఆమోదించి PDFగా డౌన్‌లోడ్ చేయాలనుకుంటున్నారా?' },
  'You can also say “yes” or “no”.': { hi: 'आप “हाँ” या “नहीं” भी बोल सकते हैं।', te: 'మీరు “అవును” లేదా “కాదు” అని కూడా చెప్పవచ్చు.' },
  Cancel: { hi: 'रद्द करें', te: 'రద్దు చేయండి' },
  Confirm: { hi: 'पुष्टि करें', te: 'నిర్ధారించండి' },
  Camera: { hi: 'कैमरा', te: 'కెమెరా' },
  Capture: { hi: 'कैप्चर', te: 'క్యాప్చర్' },

  // ----- result screens -----
  'Common causes': { hi: 'सामान्य कारण', te: 'సాధారణ కారణాలు' },
  'Precautions to take': { hi: 'बरतने योग्य सावधानियाँ', te: 'తీసుకోవాల్సిన జాగ్రత్తలు' },
  'Things to avoid': { hi: 'इन चीज़ों से बचें', te: 'వీటికి దూరంగా ఉండండి' },
  Prevention: { hi: 'बचाव', te: 'నివారణ' },
  'Healthy habits': { hi: 'स्वस्थ आदतें', te: 'ఆరోగ్యకరమైన అలవాట్లు' },
  'See a doctor quickly if': { hi: 'तुरंत डॉक्टर को दिखाएँ, अगर', te: 'ఇలా ఉంటే వెంటనే డాక్టర్‌ను కలవండి' },
  'How serious is it?': { hi: 'यह कितना गंभीर है?', te: 'ఇది ఎంత తీవ్రమైనది?' },
  'How urgent does it look?': { hi: 'यह कितना ज़रूरी लगता है?', te: 'ఇది ఎంత అత్యవసరంగా కనిపిస్తోంది?' },
  'Typical seriousness': { hi: 'आम तौर पर गंभीरता', te: 'సాధారణ తీవ్రత' },
  Normal: { hi: 'सामान्य', te: 'సాధారణం' },
  Mild: { hi: 'हल्का', te: 'స్వల్పం' },
  Moderate: { hi: 'मध्यम', te: 'మధ్యస్థం' },
  Serious: { hi: 'गंभीर', te: 'తీవ్రం' },
  Varies: { hi: 'अलग-अलग', te: 'మారుతుంది' },
  'Key points': { hi: 'मुख्य बातें', te: 'ముఖ్యాంశాలు' },
  'more likely': { hi: 'अधिक संभावना', te: 'ఎక్కువ అవకాశం' },
  possible: { hi: 'संभव', te: 'సాధ్యం' },
  'less likely': { hi: 'कम संभावना', te: 'తక్కువ అవకాశం' },
  'In short': { hi: 'संक्षेप में', te: 'సంక్షిప్తంగా' },
  Summary: { hi: 'सारांश', te: 'సారాంశం' },
  'Values outside the normal range': { hi: 'सामान्य सीमा से बाहर के मान', te: 'సాధారణ పరిధి దాటిన విలువలు' },
  'What it could point to': { hi: 'यह किस ओर इशारा कर सकता है', te: 'ఇది దేనిని సూచించవచ్చు' },
  'Suggested next tests / steps': { hi: 'सुझाए गए अगले टेस्ट / कदम', te: 'సూచించిన తదుపరి పరీక్షలు / చర్యలు' },
  'Possible conditions (prediction, not a diagnosis)': { hi: 'संभावित बीमारियाँ (अनुमान, निदान नहीं)', te: 'సంభావ్య వ్యాధులు (అంచనా మాత్రమే, నిర్ధారణ కాదు)' },
  'Red flags to rule out': { hi: 'खतरे के संकेत', te: 'ప్రమాద సంకేతాలు' },
  'Common symptoms': { hi: 'सामान्य लक्षण', te: 'సాధారణ లక్షణాలు' },
  'Who is at risk': { hi: 'किसे ज़्यादा खतरा है', te: 'ఎవరికి ప్రమాదం ఎక్కువ' },
  "How it's diagnosed": { hi: 'इसकी जाँच कैसे होती है', te: 'దీన్ని ఎలా నిర్ధారిస్తారు' },
  About: { hi: 'जानकारी', te: 'గురించి' },
  'What I understood': { hi: 'मैंने क्या समझा', te: 'నేను అర్థం చేసుకున్నది' },
  'Suggested evaluation': { hi: 'सुझाई गई जाँच', te: 'సూచించిన పరీక్షలు' },
  'Read aloud': { hi: 'पढ़कर सुनाएँ', te: 'చదివి వినిపించు' },
  'Photo analysis': { hi: 'फ़ोटो विश्लेषण', te: 'ఫోటో విశ్లేషణ' },
  'What I see in the photo': { hi: 'फ़ोटो में क्या दिख रहा है', te: 'ఫోటోలో కనిపిస్తున్నది' },
  'Possible conditions': { hi: 'संभावित बीमारियाँ', te: 'సంభావ్య వ్యాధులు' },
  'Possible symptoms': { hi: 'संभावित लक्षण', te: 'సంభావ్య లక్షణాలు' },
  'Home care / first aid': { hi: 'घरेलू देखभाल / प्राथमिक उपचार', te: 'ఇంటి సంరక్షణ / ప్రథమ చికిత్స' },
  'Tests a doctor may do': { hi: 'डॉक्टर ये जाँचें करा सकते हैं', te: 'డాక్టర్ చేయించే పరీక్షలు' },
  Disease: { hi: 'बीमारी', te: 'వ్యాధి' },
  Injury: { hi: 'चोट', te: 'గాయం' },
  'Photo quality': { hi: 'फ़ोटो की गुणवत्ता', te: 'ఫోటో నాణ్యత' },
  good: { hi: 'अच्छी', te: 'బాగుంది' },
  fair: { hi: 'ठीक-ठाक', te: 'పరవాలేదు' },
  poor: { hi: 'खराब', te: 'బాగాలేదు' },
  'Decision support only — not a diagnosis. Please review with a doctor before acting.': {
    hi: 'यह केवल सहायता के लिए है, निदान नहीं। कोई भी कदम उठाने से पहले डॉक्टर से सलाह लें।',
    te: 'ఇది సహాయం కోసం మాత్రమే, నిర్ధారణ కాదు. ఏదైనా చర్య తీసుకునే ముందు డాక్టర్‌ను సంప్రదించండి.',
  },
  'Translating…': { hi: 'अनुवाद हो रहा है…', te: 'అనువదిస్తోంది…' },
  'Report language': { hi: 'रिपोर्ट की भाषा', te: 'నివేదిక భాష' },

  // ----- body parts -----
  Brain: { hi: 'मस्तिष्क', te: 'మెదడు' }, Eyes: { hi: 'आँखें', te: 'కళ్ళు' }, Ears: { hi: 'कान', te: 'చెవులు' },
  Nose: { hi: 'नाक', te: 'ముక్కు' }, Mouth: { hi: 'मुँह', te: 'నోరు' }, Jaw: { hi: 'जबड़ा', te: 'దవడ' },
  Skull: { hi: 'खोपड़ी', te: 'పుర్రె' }, Neck: { hi: 'गर्दन', te: 'మెడ' }, Heart: { hi: 'दिल', te: 'గుండె' },
  Lungs: { hi: 'फेफड़े', te: 'ఊపిరితిత్తులు' }, Chest: { hi: 'छाती', te: 'ఛాతీ' }, Shoulders: { hi: 'कंधे', te: 'భుజాలు' },
  Liver: { hi: 'लिवर (जिगर)', te: 'కాలేయం' }, Stomach: { hi: 'पेट', te: 'కడుపు' }, Pancreas: { hi: 'पैंक्रियास (अग्न्याशय)', te: 'క్లోమం' },
  Kidneys: { hi: 'गुर्दे (किडनी)', te: 'మూత్రపిండాలు' }, Gallbladder: { hi: 'पित्ताशय', te: 'పిత్తాశయం' }, Spleen: { hi: 'तिल्ली', te: 'ప్లీహం' },
  'Small intestine': { hi: 'छोटी आँत', te: 'చిన్న ప్రేగు' }, 'Large intestine': { hi: 'बड़ी आँत', te: 'పెద్ద ప్రేగు' },
  Pelvis: { hi: 'कूल्हे की हड्डी (पेल्विस)', te: 'కటి' }, Bladder: { hi: 'मूत्राशय', te: 'మూత్రాశయం' },
  'Reproductive organs': { hi: 'प्रजनन अंग', te: 'పునరుత్పత్తి అవయవాలు' }, Spine: { hi: 'रीढ़ की हड्डी', te: 'వెన్నెముక' },
  Ribs: { hi: 'पसलियाँ', te: 'పక్కటెముకలు' }, Arms: { hi: 'बाँहें', te: 'చేతులు' }, Legs: { hi: 'पैर', te: 'కాళ్ళు' },
  Knees: { hi: 'घुटने', te: 'మోకాళ్ళు' }, Feet: { hi: 'पाँव', te: 'పాదాలు' }, Skin: { hi: 'त्वचा', te: 'చర్మం' },
}

// ---------------- runtime translation cache (for text not in DICT) ----------------
const STORE_KEY = 'medlens_ui_tr_v1'
const store: Record<Other, Record<string, string>> = (() => {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); return { hi: s.hi || {}, te: s.te || {} } } catch { return { hi: {}, te: {} } }
})()
const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)) } catch { /* storage full or blocked */ } }
const pending: Record<Other, Set<string>> = { hi: new Set(), te: new Set() }
const asked: Record<Other, Set<string>> = { hi: new Set(), te: new Set() }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

async function translateBatch(lang: Other, items: string[]) {
  for (let i = 0; i < items.length; i += 60) {
    const part = items.slice(i, i + 60)
    const r = await api.translate(lang, { ui: part })
    const out = (r.data as { ui?: string[] }).ui || []
    part.forEach((s, j) => { if (out[j]) store[lang][s] = out[j] })
  }
  persist()
}

function flush() {
  timer = null
  ;(['hi', 'te'] as Other[]).forEach(lang => {
    const items = [...pending[lang]]
    pending[lang].clear()
    if (!items.length) return
    translateBatch(lang, items).then(() => listeners.forEach(f => f())).catch(() => { /* keep English for these */ })
  })
}

function lookup(s: string, lang: Lang): string {
  if (lang === 'en' || !s) return s
  const hit = DICT[s]?.[lang] ?? store[lang][s]
  if (hit) return hit
  // Only signed-in users can call the translator; ask once per string per page load.
  if (auth.token && !asked[lang].has(s)) {
    asked[lang].add(s)
    pending[lang].add(s)
    if (!timer) timer = setTimeout(flush, 150)
  }
  return s
}

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s

/** Translate free text (e.g. an assistant reply) into `lang`; resolves to English if translation fails. */
export async function localize(text: string, lang: Lang): Promise<string> {
  if (!text || isNative(text, lang)) return text
  const L = lang as Other
  const hit = DICT[text]?.[L] ?? store[L][text]
  if (hit) return hit
  try {
    const r = await api.translate(L, { t: text })
    const out = (r.data as { t?: string }).t
    if (out) { store[L][text] = out; persist(); return out }
  } catch { /* fall back to English */ }
  return text
}

// ---------------- page-wide translator ----------------
// Catches every visible English string that was not translated in code (any screen, including the Advanced view),
// translates it once through the backend and caches it. Mark an element with data-no-translate to opt out.
const SKIP_SELECTOR = '[data-no-translate],[translate="no"],script,style,noscript,textarea,code,pre,svg,[contenteditable="true"]'
const ATTRS = ['placeholder', 'title', 'aria-label'] as const
const textOrig = new WeakMap<Node, string>()
const textMine = new WeakMap<Node, string>()
const attrOrig = new WeakMap<Element, Record<string, string>>()
const attrMine = new WeakMap<Element, Record<string, string>>()
const trackedText = new Set<Text>()
const trackedEls = new Set<Element>()

function translatable(s: string, lang: Lang) {
  const x = s.trim()
  if (x.length < 2 || x.length > 400 || isNative(x, lang) || !/[A-Za-z]{2,}/.test(x)) return false
  if (/^[A-Z0-9 .\-+/]{2,6}$/.test(x)) return false // EN, CBC, PDF, MRI …
  if (/:\/\/|@|^\S+\.(pdf|jpe?g|png|webp|docx|txt|dcm)$/i.test(x)) return false // urls, emails, file names
  if (!/\s/.test(x) && /[/_]/.test(x)) return false // ids like qwen/qwen3.8-27b
  return true
}

function scanDom(lang: Lang) {
  if (lang === 'en' || typeof document === 'undefined') return
  const root = document.getElementById('root')
  if (!root) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const cur = n.nodeValue || ''
    if (textMine.get(n) === cur) continue // our own translation, unchanged
    if (!translatable(cur, lang) || n.parentElement?.closest(SKIP_SELECTOR)) continue
    textOrig.set(n, cur)
    const core = cur.trim()
    const tr = lookup(core, lang)
    if (tr !== core) { const v = cur.replace(core, tr); n.nodeValue = v; textMine.set(n, v); trackedText.add(n) }
  }
  root.querySelectorAll<HTMLElement>('[placeholder],[title],[aria-label]').forEach(el => {
    if (el.closest(SKIP_SELECTOR)) return
    for (const a of ATTRS) {
      const cur = el.getAttribute(a)
      if (!cur || attrMine.get(el)?.[a] === cur || !translatable(cur, lang)) continue
      const tr = lookup(cur.trim(), lang)
      if (tr === cur.trim()) continue
      attrOrig.set(el, { ...(attrOrig.get(el) || {}), [a]: cur })
      attrMine.set(el, { ...(attrMine.get(el) || {}), [a]: tr })
      el.setAttribute(a, tr)
      trackedEls.add(el)
    }
  })
}

function restoreDom() {
  trackedText.forEach(n => { if (n.isConnected && textMine.get(n) === n.nodeValue && textOrig.has(n)) n.nodeValue = textOrig.get(n)! ; textMine.delete(n) })
  trackedText.clear()
  trackedEls.forEach(el => {
    const o = attrOrig.get(el), m = attrMine.get(el)
    if (o && m) for (const a of Object.keys(o)) if (el.getAttribute(a) === m[a]) el.setAttribute(a, o[a])
    attrMine.delete(el); attrOrig.delete(el)
  })
  trackedEls.clear()
}

function usePageTranslator(lang: Lang, version: number) {
  useEffect(() => {
    if (lang === 'en') return
    let raf = 0
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; scanDom(lang) }) }
    schedule()
    const obs = new MutationObserver(schedule)
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] })
    return () => { obs.disconnect(); cancelAnimationFrame(raf); restoreDom() }
  }, [lang])
  // new translations arrived from the backend: apply them
  useEffect(() => { if (lang !== 'en') scanDom(lang) }, [lang, version])
}

// ---------------- context ----------------
interface Ctx {
  lang: Lang
  setLang: (l: Lang) => void
  t: (s: string, vars?: Record<string, string | number>) => string
  speech: string
}

const LangContext = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: s => s, speech: 'en-IN' })

const KEY = 'medlens_lang'
const CHOSEN = 'medlens_lang_chosen'

export const languageChosen = () => { try { return sessionStorage.getItem(CHOSEN) === '1' } catch { return true } }

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try { const v = localStorage.getItem(KEY); return v === 'hi' || v === 'te' ? v : 'en' } catch { return 'en' }
  })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const f = () => setVersion(v => v + 1)
    listeners.add(f)
    return () => { listeners.delete(f) }
  }, [])
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  usePageTranslator(lang, version)

  const setLang = useCallback((l: Lang) => {
    try { localStorage.setItem(KEY, l); sessionStorage.setItem(CHOSEN, '1') } catch { /* ignore */ }
    setLangState(l)
  }, [])
  const value = useMemo<Ctx>(() => ({
    lang,
    setLang,
    t: (s, vars) => fill(lookup(s, lang), vars),
    speech: LANGS.find(x => x.code === lang)!.speech,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [lang, setLang, version])
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export const useLang = () => useContext(LangContext)

// ---------------- translated result objects ----------------
const cache = new Map<string, unknown>()

/**
 * Returns `data` translated into the current language (English passes straight through).
 * Falls back to the English original while translating or if translation fails.
 */
export function useTranslated<T>(data: T | null | undefined): { data: T | null; translating: boolean; error: string | null } {
  const { lang } = useLang()
  const raw = useMemo(() => (data ? JSON.stringify(data) : ''), [data])
  const key = `${lang}\u0000${raw}`
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({ key: '', data: null, error: null })

  useEffect(() => {
    if (!raw || lang === 'en') return
    if (cache.has(key)) { setState({ key, data: cache.get(key) as T, error: null }); return }
    let alive = true
    api.translate(lang, JSON.parse(raw))
      .then(r => { cache.set(key, r.data); if (alive) setState({ key, data: r.data as T, error: null }) })
      .catch(e => { if (alive) setState({ key, data: null, error: (e as Error).message }) })
    return () => { alive = false }
  }, [key, raw, lang])

  if (!data) return { data: null, translating: false, error: null }
  if (lang === 'en') return { data, translating: false, error: null }
  if (cache.has(key)) return { data: cache.get(key) as T, translating: false, error: null }
  if (state.key === key) return { data: state.data ?? data, translating: false, error: state.error }
  return { data, translating: true, error: null }
}

// ---------------- UI pieces ----------------
/** EN / हिन्दी / తెలుగు segmented switch. */
export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useLang()
  return (
    <div className="flex items-center gap-1.5" title={t('Report language')}>
      {!compact && <Languages size={15} className="text-slate-400" />}
      <div className="relative flex rounded-full bg-slate-100 p-0.5 text-xs">
        {LANGS.map(l => (
          <button key={l.code} onClick={() => setLang(l.code)} aria-pressed={lang === l.code}
            className={`relative z-10 rounded-full px-2.5 py-1 font-medium transition ${lang === l.code ? 'text-white' : 'text-slate-600 hover:text-slate-900'}`}>
            {lang === l.code && <motion.span layoutId="lang-pill" className="absolute inset-0 -z-10 rounded-full bg-brand-600 shadow" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
            {l.code === 'en' ? 'EN' : l.native}
          </button>
        ))}
      </div>
    </div>
  )
}

export function TranslatingNote({ translating, error }: { translating: boolean; error: string | null }) {
  const { t } = useLang()
  if (translating) return <div className="flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-800"><Loader2 size={13} className="animate-spin" />{t('Translating…')}</div>
  if (error) return <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Translation unavailable, showing English: {error}</div>
  return null
}

function hasVoice(code: string) {
  if (!('speechSynthesis' in window)) return false
  const vs = window.speechSynthesis.getVoices()
  return !vs.length || vs.some(v => v.lang.toLowerCase().startsWith(code.slice(0, 2)))
}

/** Full-screen language chooser shown when the app opens. */
export function LanguagePicker({ onDone }: { onDone: () => void }) {
  const { setLang } = useLang()
  const [noVoice, setNoVoice] = useState<Lang | null>(null)

  const choose = (l: (typeof LANGS)[number]) => {
    setLang(l.code)
    if (l.code !== 'en' && !hasVoice(l.speech)) { setNoVoice(l.code); setTimeout(onDone, 2600) } else onDone()
    try { // greet in the chosen language (allowed: this runs inside the click)
      const u = new SpeechSynthesisUtterance(l.hello)
      const v = window.speechSynthesis.getVoices().find(x => x.lang.toLowerCase().startsWith(l.speech.slice(0, 2)))
      if (v) u.voice = v
      u.lang = v?.lang || l.speech
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
    } catch { /* speech unavailable */ }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-50 via-white to-brand-50 p-5">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-3xl text-center">
        <motion.div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-brand-600 text-white shadow-lg"
          animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 2, repeat: Infinity }}><HeartPulse size={32} /></motion.div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Choose your language</h1>
        <p className="mt-1 text-lg text-slate-600">अपनी भाषा चुनें · మీ భాషను ఎంచుకోండి</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {LANGS.map((l, i) => (
            <motion.button key={l.code} onClick={() => choose(l)} disabled={!!noVoice}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i, type: 'spring', stiffness: 140, damping: 16 }}
              whileHover={{ y: -6, scale: 1.02 }} whileTap={{ scale: 0.97 }}
              className={`rounded-3xl border bg-white/90 p-6 text-center shadow-lg backdrop-blur transition hover:shadow-2xl ${noVoice === l.code ? 'border-brand-500 ring-2 ring-brand-300' : 'border-white/70'}`}>
              <div className="text-3xl font-bold text-slate-900">{l.native}</div>
              <div className="mt-1 text-sm text-slate-400">{l.label}</div>
              <div className="mt-4 text-lg font-semibold text-brand-700">{l.hello}</div>
              <div className="mt-1 text-sm text-slate-500">{l.sub}</div>
            </motion.button>
          ))}
        </div>
        {noVoice
          ? <p className="mt-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{DICT['Your browser has no voice for this language, so replies will be shown as text.'][noVoice as Other]}</p>
          : <p className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-500"><Mic size={14} />The screens, the voice assistant and your results will use this language.</p>}
      </motion.div>
    </div>
  )
}
