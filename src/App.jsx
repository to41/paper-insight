import React, { useState, useEffect, useRef } from 'react';
import { 
  BookOpen, Languages, FileText, Send, Loader2, Upload, Settings, 
  Search, MessageSquare, ClipboardCopy, ChevronRight, X, Check, 
  ShieldCheck, AlertCircle, BarChart3, Volume2, Globe, Sparkles, Image as ImageIcon
} from 'lucide-react';

// Safely access environment variables for different build targets
const getApiKey = () => {
  try {
    return import.meta.env.VITE_GEMINI_API_KEY || "";
  } catch (e) {
    return "";
  }
};

const API_KEY = getApiKey();

const App = () => {
  const [activeTab, setActiveTab] = useState('input');
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  
  // Initialize with safe default structure
  const [result, setResult] = useState({ 
    summary: '', 
    translation: '', 
    evidence: null, 
    relatedInfo: null 
  });
  
  const [chatMessages, setChatMessages] = useState([]);
  const [userQuestion, setUserQuestion] = useState('');
  const [generatedImage, setGeneratedImage] = useState(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);

  const [showSettings, setShowSettings] = useState(false);
  const [appSettings, setAppSettings] = useState({
    summaryLength: 'detailed', 
    ttsVoice: 'Aoede', 
    enableWebSearch: true,
    targetLanguage: '日本語'
  });

  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const fetchWithRetry = async (url, options, retryCount = 0) => {
    if (!API_KEY) {
      console.warn("API Key is missing. Check your Environment Variables.");
    }
    const response = await fetch(url, options);
    if (response.status === 429 && retryCount < 5) {
      const delay = Math.pow(2, retryCount) * 1000;
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, options, retryCount + 1);
    }
    return response;
  };

  const processPaper = async () => {
    if (!inputText && !selectedImage) {
      setStatusMessage('論文を入力してください');
      return;
    }
    setLoading(true);
    setStatusMessage('論文を多角的に解析中...');
    setGeneratedImage(null);

    try {
      const payload = {
        contents: [{
          parts: [{ 
            text: `以下の論文を解析し、JSON形式で返してください。
            要約は${appSettings.summaryLength === 'detailed' ? '詳細' : '簡潔'}に記述し、${appSettings.targetLanguage}で出力してください。
            JSONの構造は以下を厳守してください:
            {
              "summary": "要約内容",
              "translation": "日本語訳",
              "evidence": {
                "level": 1-6の数値,
                "design": "研究デザイン名",
                "reason": "判定根拠",
                "quality_score": 1-10の数値,
                "limitations": "限界点"
              }
            }\n\n論文内容:\n${inputText}` 
          }]
        }],
        generationConfig: { 
          responseMimeType: "application/json",
          temperature: 0.1 // Increase stability
        }
      };

      const response = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      );
      
      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      
      const data = await response.json();
      let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      
      // Clean up markdown blocks if any
      rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
      
      let parsed = {};
      try {
        parsed = JSON.parse(rawText);
      } catch (parseError) {
        console.error("JSON Parse Error:", rawText);
        throw new Error("AIからのレスポンス形式が正しくありませんでした。");
      }
      
      // Safe data mapping with defaults to prevent UI crash
      setResult({
        summary: parsed.summary || "要約を生成できませんでした。",
        translation: parsed.translation || "翻訳を生成できませんでした。",
        evidence: parsed.evidence || { level: 6, design: "不明", reason: "解析不能", quality_score: 0, limitations: "なし" },
        relatedInfo: null
      });

      setActiveTab('result');
      if (appSettings.enableWebSearch && parsed.summary) {
        searchRelatedWorks(parsed);
      }
    } catch (e) {
      console.error("Analysis Failure:", e);
      setStatusMessage(`解析エラー: ${e.message}`);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMessage(''), 5000);
    }
  };

  const searchRelatedWorks = async (currentResult) => {
    if (!currentResult) return;
    setStatusMessage('最新トレンドを調査中...');
    try {
      const payload = {
        contents: [{ parts: [{ text: `この研究テーマ「${currentResult?.summary?.substring(0, 80)}」に関連する最新の知見や批判を日本語でまとめてください。` }] }],
        tools: [{ google_search: {} }]
      };
      const response = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      );
      
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const sources = data.candidates?.[0]?.groundingMetadata?.groundingAttributions?.map(a => ({ 
        uri: a.web?.uri, 
        title: a.web?.title 
      })) || [];
      
      if (text) {
        setResult(prev => ({ ...prev, relatedInfo: { text, sources } }));
      }
    } catch (e) {
      console.error("Search Fail:", e);
    } finally {
      setStatusMessage('');
    }
  };

  const generateConceptArt = async () => {
    if (!result.summary || loading) return;
    setLoading(true);
    setStatusMessage('AIで概念を視覚化中...');
    try {
      const prompt = `Professional scientific infographic illustrating: ${result.summary.substring(0, 150)}`;
      const response = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${API_KEY}`,
        { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instances: { prompt }, parameters: { sampleCount: 1 } }) 
        }
      );
      const data = await response.json();
      if (data.predictions?.[0]?.bytesBase64Encoded) {
        setGeneratedImage(`data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`);
      }
    } catch (e) {
      setStatusMessage('画像生成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const playSummaryAudio = async () => {
    if (isAudioPlaying || !result.summary) return;
    setIsAudioPlaying(true);
    try {
      const response = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `抄録の要約を読み上げます。${result.summary}` }] }],
            generationConfig: { 
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: appSettings.ttsVoice } } }
            }
          })
        }
      );
      const data = await response.json();
      const pcmData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (pcmData) {
        const audioBlob = pcmToWav(pcmData, 24000);
        const audio = new Audio(URL.createObjectURL(audioBlob));
        audio.onended = () => setIsAudioPlaying(false);
        audio.play();
      } else {
        setIsAudioPlaying(false);
      }
    } catch (e) {
      setIsAudioPlaying(false);
    }
  };

  const pcmToWav = (base64, sampleRate) => {
    const buffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
    const view = new DataView(new ArrayBuffer(44 + buffer.byteLength));
    const writeString = (offset, string) => { for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i)); };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + buffer.byteLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, buffer.byteLength, true);
    new Uint8Array(view.buffer, 44).set(new Uint8Array(buffer));
    return new Blob([view], { type: 'audio/wav' });
  };

  const askQuestion = async () => {
    if (!userQuestion.trim() || loading) return;
    const q = userQuestion;
    setChatMessages(prev => [...prev, { role: 'user', text: q }]);
    setUserQuestion('');
    setLoading(true);

    try {
      const response = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `要約: ${result.summary}\n質問: ${q}` }] }],
            systemInstruction: { parts: [{ text: "高度な学術論文の専門家として、提供された背景情報を基に、誠実かつ詳細に日本語で回答してください。" }] }
          })
        }
      );
      const data = await response.json();
      const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || "回答を生成できませんでした。";
      setChatMessages(prev => [...prev, { role: 'model', text: answer }]);
    } catch (e) {
      setChatMessages(prev => [...prev, { role: 'model', text: "すみません、対話中にエラーが発生しました。" }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f9fafb] text-slate-900 font-sans antialiased">
      <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-30 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-2.5 rounded-2xl shadow-lg shadow-blue-100">
              <Sparkles className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-black tracking-tight text-slate-800">PaperInsight <span className="text-blue-600">Pro Max</span></h1>
          </div>
          <button onClick={() => setShowSettings(true)} className="p-2.5 hover:bg-slate-100 rounded-full transition-all text-slate-400 hover:text-blue-600">
            <Settings className="w-6 h-6" />
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in duration-200">
            <div className="p-8 border-b flex justify-between items-center bg-slate-50">
              <h2 className="font-black text-xl flex items-center gap-2"><Settings className="w-5 h-5 text-blue-600" /> 設定</h2>
              <button onClick={() => setShowSettings(false)} className="hover:bg-slate-200 p-2 rounded-full transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-8 space-y-8">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">要約の詳細度</label>
                <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1.5 rounded-2xl">
                  {['concise', 'detailed'].map(v => (
                    <button key={v} onClick={() => setAppSettings({...appSettings, summaryLength: v})} className={`py-2 text-sm font-black rounded-xl transition-all ${appSettings.summaryLength === v ? 'bg-white shadow text-blue-600' : 'text-slate-500'}`}>
                      {v === 'concise' ? '簡潔' : '詳細'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-700">自動Web検索を有効化</span>
                <button onClick={() => setAppSettings({...appSettings, enableWebSearch: !appSettings.enableWebSearch})} className={`w-12 h-6 rounded-full transition-all relative ${appSettings.enableWebSearch ? 'bg-blue-600' : 'bg-slate-300'}`}>
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${appSettings.enableWebSearch ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
            </div>
            <div className="p-8 text-right bg-slate-50">
              <button onClick={() => setShowSettings(false)} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black shadow-lg shadow-blue-100 active:scale-95 transition-all">保存</button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-6 py-8">
        <nav className="flex bg-slate-200/50 p-1.5 rounded-3xl mb-10 w-fit mx-auto border border-white/50 backdrop-blur-sm sticky top-24 z-20 shadow-sm">
          {['input', 'result', 'chat'].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-10 py-3.5 rounded-2xl text-sm font-black transition-all ${activeTab === tab ? 'bg-white shadow-lg text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}>
              {tab === 'input' ? 'Manuscript' : tab === 'result' ? 'Intelligence' : 'Q&A'}
            </button>
          ))}
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-8 space-y-8">
            {activeTab === 'input' && (
              <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-100 p-10 animate-in fade-in slide-in-from-bottom-4">
                <textarea 
                  className="w-full h-[500px] p-8 rounded-[2rem] border border-slate-100 focus:ring-8 focus:ring-blue-50 outline-none resize-none bg-slate-50/50 transition-all text-base leading-relaxed mb-10 font-medium shadow-inner" 
                  placeholder="論文の抄録や本文を貼り付けてください..." 
                  value={inputText} 
                  onChange={(e) => setInputText(e.target.value)} 
                />
                <button onClick={processPaper} disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 text-white font-black text-xl rounded-3xl py-10 transition-all flex items-center justify-center gap-4 shadow-xl shadow-blue-100 active:scale-[0.98]">
                  {loading ? <Loader2 className="w-8 h-8 animate-spin" /> : <><Search className="w-8 h-8" />多角的AI解析を実行</>}
                </button>
              </div>
            )}

            {activeTab === 'result' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                {result.evidence && (
                  <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-200 overflow-hidden relative border-l-[14px] border-l-blue-600 p-10">
                    <div className="flex flex-wrap items-center justify-between gap-6 mb-8">
                      <div className="flex items-center gap-5">
                        <div className="px-8 py-5 rounded-3xl font-black text-3xl bg-amber-50 text-amber-900 border-2 border-amber-100 shadow-sm">LV.{result.evidence.level}</div>
                        <h2 className="text-3xl font-black text-slate-800 tracking-tight">{result.evidence.design}</h2>
                      </div>
                      <button onClick={playSummaryAudio} disabled={isAudioPlaying || !result.summary} className={`flex items-center gap-3 px-6 py-4 rounded-2xl font-black text-sm transition-all shadow-sm ${isAudioPlaying ? 'bg-slate-100 text-slate-400' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                        <Volume2 className={`w-5 h-5 ${isAudioPlaying ? 'animate-bounce' : ''}`} /> 要約を聴く
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="bg-slate-50 p-8 rounded-[2rem] border border-slate-100 text-sm font-bold leading-relaxed shadow-inner">
                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-3">判定根拠</p>
                        {result.evidence.reason}
                      </div>
                      <div className="bg-red-50/50 p-8 rounded-[2rem] border border-red-100 text-sm font-bold text-red-900 leading-relaxed shadow-inner">
                         <p className="text-[10px] text-red-400 font-black uppercase tracking-widest mb-3">限界点とリスク</p>
                        {result.evidence.limitations}
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="bg-white rounded-[3rem] shadow-xl border border-slate-100 p-12 space-y-12">
                  {result.summary && (
                    <section>
                      <div className="flex items-center justify-between mb-8">
                        <h3 className="text-2xl font-black text-slate-800 flex items-center gap-4"><FileText className="w-8 h-8 text-blue-600" /> AI解析レポート</h3>
                        <button onClick={generateConceptArt} disabled={loading} className="text-xs font-black text-indigo-600 bg-indigo-50 px-5 py-2.5 rounded-xl border border-indigo-100 hover:bg-indigo-100 transition-all">概念を視覚化</button>
                      </div>
                      {generatedImage && <div className="mb-10 rounded-[2.5rem] overflow-hidden shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-500"><img src={generatedImage} alt="Visual Concept" className="w-full h-auto" /></div>}
                      <div className="text-lg text-slate-700 leading-loose p-10 bg-slate-50 rounded-[2.5rem] border border-slate-100 font-bold whitespace-pre-wrap shadow-inner">{result.summary}</div>
                    </section>
                  )}
                  {result.relatedInfo && (
                    <section className="pt-10 border-t border-slate-100">
                      <h3 className="text-2xl font-black text-slate-800 mb-8 flex items-center gap-4"><Globe className="w-8 h-8 text-emerald-600" /> 関連トレンドと最新知見</h3>
                      <div className="bg-emerald-50/20 p-10 rounded-[2.5rem] border border-emerald-100/50 text-base text-slate-800 font-bold leading-relaxed whitespace-pre-wrap shadow-inner">
                        {result.relatedInfo.text}
                        <div className="mt-8 flex flex-wrap gap-2">
                          {result.relatedInfo.sources?.map((s, i) => (
                            <a key={i} href={s.uri} target="_blank" rel="noreferrer" className="text-[10px] bg-white px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-600 font-black hover:bg-emerald-50">🔗 {s.title || "参考資料"}</a>
                          ))}
                        </div>
                      </div>
                    </section>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'chat' && (
              <div className="bg-white rounded-[2.5rem] shadow-xl flex flex-col h-[750px] animate-in fade-in slide-in-from-bottom-4 overflow-hidden border border-slate-100">
                <div className="flex-1 p-10 overflow-y-auto space-y-8 bg-slate-50/30">
                  {chatMessages.length === 0 && (
                    <div className="text-center py-40">
                      <div className="bg-blue-100/50 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-8"><MessageSquare className="w-10 h-10 text-blue-300" /></div>
                      <h3 className="font-black text-2xl text-slate-800">Expert Dialogue</h3>
                      <p className="text-slate-400 font-bold mt-3">この論文について、統計的な疑問や手法の<br/>妥当性などをAIに質問してください。</p>
                    </div>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] p-6 rounded-[2rem] shadow-sm text-base font-bold leading-relaxed ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none border border-slate-200'}`}>
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  <div ref={scrollRef} />
                </div>
                <div className="p-8 bg-white border-t border-slate-100 flex gap-4">
                  <input type="text" className="flex-1 p-5 rounded-2xl border border-slate-200 outline-none focus:ring-8 focus:ring-blue-50 bg-slate-50 font-bold transition-all shadow-inner" placeholder="質問を入力してください..." value={userQuestion} onChange={(e) => setUserQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && askQuestion()} />
                  <button onClick={askQuestion} disabled={loading} className="p-5 bg-blue-600 text-white rounded-2xl shadow-xl shadow-blue-100 transition-all active:scale-95 disabled:bg-slate-300"><Send className="w-7 h-7" /></button>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-4 space-y-8">
            <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-100 p-10 sticky top-40">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-8">AI Intelligence Panel</h3>
              <div className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100 flex items-center justify-between shadow-inner mb-6">
                <span className="text-xs font-black text-slate-500">Quality Score</span>
                <span className="text-3xl font-black text-blue-600">{result.evidence?.quality_score || 0}<span className="text-sm text-slate-300 ml-1">/10</span></span>
              </div>
              <div className="bg-slate-900 rounded-[2.5rem] p-10 text-white relative overflow-hidden group shadow-2xl text-sm font-bold opacity-90 leading-relaxed min-h-[120px]">
                 {result.summary ? "論文の解析が完了しました。エビデンスレベルと限界点を確認し、必要に応じてQ&Aタブで詳細を質問してください。" : "論文を読み込むと、ここにAIによる総合評価が表示されます。"}
                 <Sparkles className="absolute -right-4 -bottom-4 w-20 h-20 opacity-5 group-hover:opacity-10 transition-opacity" />
              </div>
            </div>
          </div>
        </div>

        {statusMessage && (
          <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50">
            <div className="bg-slate-900/95 backdrop-blur-xl text-white px-10 py-5 rounded-[2.5rem] shadow-2xl flex items-center gap-5 border border-white/10">
              <div className="flex gap-1.5"><div className="w-3 h-3 bg-blue-400 rounded-full animate-bounce" /><div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce [animation-delay:0.2s]" /><div className="w-3 h-3 bg-blue-600 rounded-full animate-bounce [animation-delay:0.4s]" /></div>
              <span className="text-sm font-black tracking-wide">{statusMessage}</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
