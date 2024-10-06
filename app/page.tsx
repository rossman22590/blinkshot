'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, UseQueryResult } from "@tanstack/react-query"
import { useDebounce } from "@uidotdev/usehooks"

import Image from "next/image"
import { Mic, MicOff, Download } from 'lucide-react';

import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import Spinner from "@/components/spinner"

import imagePlaceholder from "@/public/image-placeholder.png"

import JSZip from 'jszip';
import { saveAs } from 'file-saver';

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

declare global {
  interface Window {
    SpeechRecognition: {
      prototype: SpeechRecognition;
      new(): SpeechRecognition;
    };
    webkitSpeechRecognition: {
      prototype: SpeechRecognition;
      new(): SpeechRecognition;
    };
  }
}

interface HistoryItem {
  prompt: string;
  image: string;
}

interface ApiResponse {
  b64_json: string;
  timings: { inference: number };
}

export default function ImageGenerator() {
  const [prompt, setPrompt] = useState("A cinematic shot of a baby raccoon wearing an intricate Italian priest robe")
  const [micOn, setMicOn] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [currentImage, setCurrentImage] = useState<string | null>(null)
  const [nextImage, setNextImage] = useState<string | null>(null)

  const debouncedPrompt = useDebounce(prompt, 300)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const [isSpeechSupported, setIsSpeechSupported] = useState(false)

  useEffect(() => {
    const SpeechRecognitionConstructor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognitionConstructor) {
      setIsSpeechSupported(true)
      recognitionRef.current = new SpeechRecognitionConstructor()
      recognitionRef.current.continuous = true
      recognitionRef.current.interimResults = true
      recognitionRef.current.lang = 'en-US'

      recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
        let finalTranscript = ''

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript
          }
        }

        if (finalTranscript !== '') {
          setPrompt(prev => `${prev} ${finalTranscript}`.trim())
        }
      }

      recognitionRef.current.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error("Speech Recognition Error:", event.error)
        setMicOn(false)
      }

      recognitionRef.current.onend = () => {
        if (micOn) {
          try {
            recognitionRef.current?.start()
          } catch (err) {
            console.error("Failed to restart recognition:", err)
            setMicOn(false)
          }
        }
      }
    } else {
      console.warn("Speech Recognition API is not supported in this browser.")
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [])

  useEffect(() => {
    if (micOn && recognitionRef.current) {
      try {
        recognitionRef.current.start()
      } catch (err) {
        console.error("Failed to start recognition:", err)
        setMicOn(false)
      }
    } else if (!micOn && recognitionRef.current) {
      recognitionRef.current.stop()
    }
  }, [micOn])

  const toggleMic = () => {
    setMicOn(prev => !prev)
  }

  const { data: image, isFetching }: UseQueryResult<ApiResponse, Error> = useQuery<ApiResponse, Error>({
    queryKey: [debouncedPrompt],
    queryFn: async () => {
      const res = await fetch("/api/generateImages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      })

      if (!res.ok) {
        throw new Error(await res.text())
      }
      return await res.json()
    },
    enabled: !!debouncedPrompt.trim(),
    staleTime: Infinity,
    retry: false,
  })

  useEffect(() => {
    if (image) {
      const newImageUrl = `data:image/png;base64,${image.b64_json}`
      setNextImage(newImageUrl)
      
      const transitionTimer = setTimeout(() => {
        setCurrentImage(newImageUrl)
        setNextImage(null)
      }, 500)

      const historyTimer = setTimeout(() => {
        setHistory(prev => [
          ...prev,
          {
            prompt: debouncedPrompt,
            image: newImageUrl
          }
        ])
      }, 1000)

      return () => {
        clearTimeout(transitionTimer)
        clearTimeout(historyTimer)
      }
    }
  }, [image, debouncedPrompt])

  const handleDownloadAll = async () => {
    const zip = new JSZip();
    const folder = zip.folder("generated_images");

    if (!folder) {
      console.error("Failed to create ZIP folder.");
      return;
    }

    const base64ToBlob = (base64: string, mime: string): Blob => {
      const byteCharacters = atob(base64);
      const byteArrays: Uint8Array[] = [];

      for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);

        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
          byteNumbers[i] = slice.charCodeAt(i);
        }

        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
      }

      return new Blob(byteArrays, { type: mime });
    };

    history.forEach((item, index) => {
      const base64String = item.image.split(',')[1];
      const blob = base64ToBlob(base64String, 'image/png');
      folder.file(`image_${index + 1}.png`, blob);
    });

    if (currentImage) {
      const isCurrentInHistory = history.some(
        (item) => item.image === currentImage
      );

      if (!isCurrentInHistory) {
        const base64String = currentImage.split(',')[1];
        const blob = base64ToBlob(base64String, 'image/png');
        folder.file(`current_image.png`, blob);
      }
    }

    try {
      const zipBlob = await zip.generateAsync({ type: "blob" });
      saveAs(zipBlob, "generated_images.zip");
    } catch (err) {
      console.error("Error generating ZIP:", err);
    }
  };

  const isDebouncing = prompt !== debouncedPrompt

  return (
    <div className="min-h-screen bg-[#0e0e10] text-white p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="text-center py-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 text-transparent bg-clip-text animate-gradient">
            TurboCraft Beta
          </h1>
        </header>

        <div className="flex items-center space-x-4 relative">
          <div className="flex-1">
            <Label htmlFor="prompt" className="text-gray-300">Prompt</Label>
            <Textarea
              id="prompt"
              rows={4}
              spellCheck={false}
              placeholder="Describe your image..."
              required
              value={prompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
              className="w-full resize-none border-gray-300 border-opacity-50 bg-gray-400 px-4 text-base placeholder-gray-300 mt-1"
            />
            <div
              className={`${isFetching || isDebouncing ? "flex" : "hidden"} absolute bottom-3 right-3 items-center justify-center`}
            >
              <Spinner className="size-4" />
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {isSpeechSupported ? (
              <>
                <Switch
                  checked={micOn}
                  onCheckedChange={toggleMic}
                  className="bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500"
                />
                <Label htmlFor="mic-switch" className="text-gray-300">
                  {micOn ? (
                    <Mic className="h-6 w-6 text-white" />
                  ) : (
                    <MicOff className="h-6 w-6 text-gray-400" />
                  )}
                </Label>
              </>
            ) : (
              <p className="text-red-500 text-sm">Speech recognition not supported in this browser.</p>
            )}
          </div>
        </div>

        <Button 
          onClick={handleDownloadAll}
          className="w-full bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 hover:from-pink-600 hover:via-purple-600 hover:to-indigo-600 text-white font-semibold py-2 px-4 rounded flex items-center justify-center"
        >
          <Download className="mr-2 h-4 w-4" /> Download All
        </Button>

        <div className="flex space-x-4">
          <div className="flex-1">
            <div className="relative w-full aspect-square bg-blue-500 rounded-lg overflow-hidden">
              {currentImage && (
                <Image
                  src={currentImage}
                  alt="Current generated image"
                  layout="fill"
                  objectFit="cover"
                  className="transition-opacity duration-500 ease-in-out"
                />
              )}
              {nextImage && (
                <Image
                  src={nextImage}
                  alt="Next generated image"
                  layout="fill"
                  objectFit="cover"
                  className="absolute top-0 left-0 transition-opacity duration-500 ease-in-out opacity-0"
                  style={{ opacity: currentImage ? 0 : 1 }}
                />
              )}
            </div>
          </div>
          <div className="w-1/4 overflow-y-auto max-h-[80vh] space-y-4">
            <h2 className="text-xl font-semibold mb-2">History</h2>
            {history.length === 0 ? (
              <p className="text-gray-400">No images generated yet.</p>
            ) : (
              history.map((item, index) => (
                <div key={index} className="bg-gray-700 p-2 rounded-lg">
                  <p className="text-sm text-gray-300 mb-1">Prompt: {item.prompt}</p>
                  <Image
                    src={item.image}
                    alt={`Generated image ${index + 1}`}
                    width={256}
                    height={256}
                    className="w-full aspect-square object-cover rounded-lg"
                    placeholder="blur"
                    blurDataURL={imagePlaceholder.blurDataURL}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        {/* <footer className="mt-16 w-full items-center pb-10 text-center text-gray-300 md:mt-4 md:flex md:justify-between md:pb-5 md:text-xs lg:text-sm">
          <p>
            Powered by{" "}
            <a
              href="https://www.dub.sh/together-ai"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 transition hover:text-blue-500"
            >
              Together.ai
            </a>{" "}
            &{" "}
            <a
              href="https://dub.sh/together-flux"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 transition hover:text-blue-500"
            >
              Flux
            </a>
          </p>

          <div className="mt-8 flex items-center justify-center md:mt-0 md:justify-between md:gap-6">
            <p className="hidden whitespace-nowrap md:block">
              100% free and{" "}
              <a
                href="https://github.com/Nutlope/blinkshot"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 transition hover:text-blue-500"
              >
                open source
              </a>
            </p>

            <div className="flex gap-6 md:gap-2">
              <a href="https://pixio.myapps.ai" target="_blank" rel="noopener noreferrer">
                <Button
                  variant="outline"
                  size="sm"
                  className="inline-flex items-center gap-2"
                >
                  <GithubIcon className="size-4" />
                  Pixio
                </Button>
              </a>
              <a href="https://x.com/tsi_org" target="_blank" rel="noopener noreferrer">
                <Button
                  size="sm"
                  variant="outline"
                  className="inline-flex items-center gap-2"
                >
                  <XIcon className="size-3" />
                  Twitter
                </Button>
              </a>
            </div>
          </div>
        </footer> */}
      </div>
    </div>
  )
}
// 'use client'

// import { useState, useEffect, useRef } from 'react'
// import { useQuery, UseQueryResult } from "@tanstack/react-query"
// import { useDebounce } from "@uidotdev/usehooks"
// import GithubIcon from "@/components/icons/github-icon";
// import XIcon from "@/components/icons/x-icon";
// import Image from "next/image"
// import { Mic, MicOff, Download } from 'lucide-react';

// import { Input } from "@/components/ui/input"
// import { Textarea } from "@/components/ui/textarea"
// import { Button } from "@/components/ui/button"
// import { Label } from "@/components/ui/label"
// import { Switch } from "@/components/ui/switch"
// import Spinner from "@/components/spinner"
// import Logo from "@/components/logo";

// import imagePlaceholder from "@/public/image-placeholder.png"

// import JSZip from 'jszip';
// import { saveAs } from 'file-saver';

// interface SpeechRecognition extends EventTarget {
//   continuous: boolean;
//   interimResults: boolean;
//   lang: string;
//   start: () => void;
//   stop: () => void;
//   onresult: (event: SpeechRecognitionEvent) => void;
//   onerror: (event: SpeechRecognitionErrorEvent) => void;
//   onend: () => void;
// }

// interface SpeechRecognitionEvent {
//   resultIndex: number;
//   results: SpeechRecognitionResultList;
// }

// interface SpeechRecognitionErrorEvent {
//   error: string;
//   message: string;
// }

// declare global {
//   interface Window {
//     SpeechRecognition: {
//       prototype: SpeechRecognition;
//       new(): SpeechRecognition;
//     };
//     webkitSpeechRecognition: {
//       prototype: SpeechRecognition;
//       new(): SpeechRecognition;
//     };
//   }
// }

// interface HistoryItem {
//   prompt: string;
//   image: string;
// }

// interface ApiResponse {
//   b64_json: string;
//   timings: { inference: number };
// }

// export default function ImageGenerator() {
//   const [prompt, setPrompt] = useState("A cinematic shot of a baby raccoon wearing an intricate Italian priest robe")
//   const [userAPIKey, setUserAPIKey] = useState("")
//   const [micOn, setMicOn] = useState(false)
//   const [history, setHistory] = useState<HistoryItem[]>([])
//   const [currentImage, setCurrentImage] = useState<string | null>(null)
//   const [nextImage, setNextImage] = useState<string | null>(null)

//   const debouncedPrompt = useDebounce(prompt, 300)
//   const recognitionRef = useRef<SpeechRecognition | null>(null)
//   const [isSpeechSupported, setIsSpeechSupported] = useState(false)

//   useEffect(() => {
//     const SpeechRecognitionConstructor = window.SpeechRecognition || window.webkitSpeechRecognition
//     if (SpeechRecognitionConstructor) {
//       setIsSpeechSupported(true)
//       const recognition = new SpeechRecognitionConstructor()
//       recognition.continuous = true
//       recognition.interimResults = true
//       recognition.lang = 'en-US'

//       recognition.onresult = (event: SpeechRecognitionEvent) => {
//         let interimTranscript = ''
//         let finalTranscript = ''

//         for (let i = event.resultIndex; i < event.results.length; ++i) {
//           if (event.results[i].isFinal) {
//             finalTranscript += event.results[i][0].transcript
//           } else {
//             interimTranscript += event.results[i][0].transcript
//           }
//         }

//         if (finalTranscript !== '') {
//           setPrompt(prev => `${prev} ${finalTranscript}`.trim())
//         }
//       }

//       recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
//         console.error("Speech Recognition Error:", event.error)
//         setMicOn(false)
//       }

//       recognition.onend = () => {
//         if (micOn) {
//           try {
//             recognition.start()
//           } catch (err) {
//             console.error("Failed to restart recognition:", err)
//             setMicOn(false)
//           }
//         }
//       }

//       recognitionRef.current = recognition
//     } else {
//       console.warn("Speech Recognition API is not supported in this browser.")
//     }

//     return () => {
//       if (recognitionRef.current) {
//         recognitionRef.current.stop()
//       }
//     }
//   }, [micOn])

//   const toggleMic = () => {
//     setMicOn(prev => {
//       const newState = !prev
//       if (newState && recognitionRef.current) {
//         try {
//           recognitionRef.current.start()
//         } catch (err) {
//           console.error("Failed to start recognition:", err)
//           return false
//         }
//       } else if (!newState && recognitionRef.current) {
//         recognitionRef.current.stop()
//       }
//       return newState
//     })
//   }

//   const { data: image, isFetching }: UseQueryResult<ApiResponse, Error> = useQuery<ApiResponse, Error>({
//     queryKey: [debouncedPrompt],
//     queryFn: async () => {
//       const res = await fetch("/api/generateImages", {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({ prompt, userAPIKey }),
//       })

//       if (!res.ok) {
//         throw new Error(await res.text())
//       }
//       return await res.json()
//     },
//     enabled: !!debouncedPrompt.trim(),
//     staleTime: Infinity,
//     retry: false,
//   })

//   useEffect(() => {
//     if (image) {
//       const newImageUrl = `data:image/png;base64,${image.b64_json}`
//       setNextImage(newImageUrl)
      
//       // Start the transition
//       const transitionTimer = setTimeout(() => {
//         setCurrentImage(newImageUrl)
//         setNextImage(null)
//       }, 500) // This should match the CSS transition duration

//       // Add to history after transition
//       const historyTimer = setTimeout(() => {
//         setHistory(prev => [
//           ...prev,
//           {
//             prompt: debouncedPrompt,
//             image: newImageUrl
//           }
//         ])
//       }, 1000) // This should be longer than the transition duration

//       return () => {
//         clearTimeout(transitionTimer)
//         clearTimeout(historyTimer)
//       }
//     }
//   }, [image, debouncedPrompt])

//   const handleDownloadAll = async () => {
//     const zip = new JSZip();
//     const folder = zip.folder("generated_images");

//     if (!folder) {
//       console.error("Failed to create ZIP folder.");
//       return;
//     }

//     const base64ToBlob = (base64: string, mime: string): Blob => {
//       const byteCharacters = atob(base64);
//       const byteArrays: Uint8Array[] = [];

//       for (let offset = 0; offset < byteCharacters.length; offset += 512) {
//         const slice = byteCharacters.slice(offset, offset + 512);

//         const byteNumbers = new Array(slice.length);
//         for (let i = 0; i < slice.length; i++) {
//           byteNumbers[i] = slice.charCodeAt(i);
//         }

//         const byteArray = new Uint8Array(byteNumbers);
//         byteArrays.push(byteArray);
//       }

//       return new Blob(byteArrays, { type: mime });
//     };

//     history.forEach((item, index) => {
//       const base64String = item.image.split(',')[1];
//       const blob = base64ToBlob(base64String, 'image/png');
//       folder.file(`image_${index + 1}.png`, blob);
//     });

//     if (currentImage) {
//       const isCurrentInHistory = history.some(
//         (item) => item.image === currentImage
//       );

//       if (!isCurrentInHistory) {
//         const base64String = currentImage.split(',')[1];
//         const blob = base64ToBlob(base64String, 'image/png');
//         folder.file(`current_image.png`, blob);
//       }
//     }

//     try {
//       const zipBlob = await zip.generateAsync({ type: "blob" });
//       saveAs(zipBlob, "generated_images.zip");
//     } catch (err) {
//       console.error("Error generating ZIP:", err);
//     }
//   };

//   const isDebouncing = prompt !== debouncedPrompt

//   return (
//     <div className="min-h-screen bg-[#0e0e10] text-white p-4">
//       <div className="max-w-6xl mx-auto space-y-6">
//         <header className="flex justify-center pt-20 md:justify-end md:pt-3">
//           <div className="absolute left-1/2 top-6 -translate-x-1/2">
//             <a href="https://www.dub.sh/together-ai" target="_blank" rel="noopener noreferrer">
//               <Logo />
//             </a>
//           </div>
//           <div>
//             <Label htmlFor="api-key" className="text-gray-300 text-xs">
//               [Optional] Add your{" "}
//               <a
//                 href="https://api.together.xyz/settings/api-keys"
//                 target="_blank"
//                 rel="noopener noreferrer"
//                 className="underline underline-offset-4 transition hover:text-blue-500"
//               >
//                 Together API Key
//               </a>
//             </Label>
//             <Input
//               id="api-key"
//               placeholder="API Key"
//               type="password"
//               value={userAPIKey}
//               className="mt-1 bg-gray-400 text-gray-200 placeholder:text-gray-300"
//               onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUserAPIKey(e.target.value)}
//             />
//           </div>
//         </header>

//         <div className="flex items-center space-x-4 relative">
//           <div className="flex-1">
//             <Label htmlFor="prompt" className="text-gray-300">Prompt</Label>
//             <Textarea
//               id="prompt"
//               rows={4}
//               spellCheck={false}
//               placeholder="Describe your image..."
//               required
//               value={prompt}
//               onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
//               className="w-full resize-none border-gray-300 border-opacity-50 bg-gray-400 px-4 text-base placeholder-gray-300 mt-1"
//             />
//             <div
//               className={`${isFetching || isDebouncing ? "flex" : "hidden"} absolute bottom-3 right-3 items-center justify-center`}
//             >
//               <Spinner className="size-4" />
//             </div>
//           </div>
//           <div className="flex items-center space-x-2">
//             {isSpeechSupported ? (
//               <>
//                 <Switch
//                   checked={micOn}
//                   onCheckedChange={toggleMic}
//                   className="bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500"
//                 />
//                 <Label htmlFor="mic-switch" className="text-gray-300">
//                   {micOn ? (
//                     <Mic className="h-6 w-6 text-white" />
//                   ) : (
//                     <MicOff className="h-6 w-6 text-gray-400" />
//                   )}
//                 </Label>
//               </>
//             ) : (
//               <p className="text-red-500 text-sm">Speech recognition not supported in this browser.</p>
//             )}
//           </div>
//         </div>

//         <Button 
//           onClick={handleDownloadAll}
//           className="w-full bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 hover:from-pink-600 hover:via-purple-600 hover:to-indigo-600 text-white font-semibold py-2 px-4 rounded flex items-center justify-center"
//         >
//           <Download className="mr-2 h-4 w-4" /> Download All
//         </Button>

//         <div className="flex space-x-4">
//           <div className="flex-1">
//             <div className="relative w-full aspect-square bg-blue-500 rounded-lg overflow-hidden">
//               {currentImage && (
//                 <Image
//                   src={currentImage}
//                   alt="Current generated image"
//                   layout="fill"
//                   objectFit="cover"
//                   className="transition-opacity duration-500 ease-in-out"
//                 />
//               )}
//               {nextImage && (
//                 <Image
//                   src={nextImage}
//                   alt="Next generated image"
//                   layout="fill"
//                   objectFit="cover"
//                   className="absolute top-0 left-0 transition-opacity duration-500 ease-in-out opacity-0"
//                   style={{ opacity: currentImage ? 0 : 1 }}
//                 />
//               )}
//             </div>
//           </div>
//           <div className="w-1/4 overflow-y-auto max-h-[80vh] space-y-4">
//             <h2 className="text-xl font-semibold mb-2">History</h2>
//             {history.length === 0 ? (
//               <p className="text-gray-400">No images generated yet.</p>
//             ) : (
//               history.map((item, index) => (
//                 <div key={index} className="bg-gray-700 p-2 rounded-lg">
//                   <p className="text-sm text-gray-300 mb-1">Prompt: {item.prompt}</p>
//                   <Image
//                     src={item.image}
//                     alt={`Generated image ${index + 1}`}
//                     width={256}
//                     height={256}
//                     className="w-full aspect-square object-cover rounded-lg"
//                     placeholder="blur"
//                     blurDataURL={imagePlaceholder.blurDataURL}
//                   />
//                 </div>
//               ))
//             )}
//           </div>
//         </div>

//         <footer className="mt-16 w-full items-center pb-10 text-center text-gray-300 md:mt-4 md:flex md:justify-between md:pb-5 md:text-xs lg:text-sm">
//           <p>
//             Powered by{" "}
//             <a
//               href="https://www.dub.sh/together-ai"
//               target="_blank"
//               rel="noopener noreferrer"
//               className="underline underline-offset-4 transition hover:text-blue-500"
//             >
//               Together.ai
//             </a>{" "}
//             &{" "}
//             <a
//               href="https://dub.sh/together-flux"
//               target="_blank"
//               rel="noopener noreferrer"
//               className="underline underline-offset-4 transition hover:text-blue-500"
//             >
//               Flux
//             </a>
//           </p>

//           <div className="mt-8 flex items-center justify-center md:mt-0 md:justify-between md:gap-6">
//             <p className="hidden whitespace-nowrap md:block">
//               100% free and{" "}
//               <a
//                 href="https://github.com/Nutlope/blinkshot"
//                 target="_blank"
//                 rel="noopener noreferrer"
//                 className="underline underline-offset-4 transition hover:text-blue-500"
//               >
//                 open source
//               </a>
//             </p>

//             <div className="flex gap-6 md:gap-2">
//               <a href="https://github.com/Nutlope/blinkshot" target="_blank" rel="noopener noreferrer">
//                 <Button
//                   variant="outline"
//                   size="sm"
//                   className="inline-flex items-center gap-2"
//                 >
//                   <GithubIcon className="size-4" />
//                   GitHub
//                 </Button>
//               </a>
//               <a href="https://x.com/nutlope" target="_blank" rel="noopener noreferrer">
//                 <Button
//                   size="sm"
//                   variant="outline"
//                   className="inline-flex items-center gap-2"
//                 >
//                   <XIcon className="size-3" />
//                   Twitter
//                 </Button>
//               </a>
//             </div>
//           </div>
//         </footer>
//       </div>
//     </div>
//   )
// }

// "use client";

// import GithubIcon from "@/components/icons/github-icon";
// import XIcon from "@/components/icons/x-icon";
// import Logo from "@/components/logo";
// import Spinner from "@/components/spinner";
// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { Textarea } from "@/components/ui/textarea";
// import imagePlaceholder from "@/public/image-placeholder.png";
// import { useQuery } from "@tanstack/react-query";
// import { useDebounce } from "@uidotdev/usehooks";
// import Image from "next/image";
// import { useState } from "react";

// export default function Home() {
//   const [prompt, setPrompt] = useState("");
//   const [userAPIKey, setUserAPIKey] = useState("");
//   const debouncedPrompt = useDebounce(prompt, 300);

//   const { data: image, isFetching } = useQuery({
//     placeholderData: (previousData) => previousData,
//     queryKey: [debouncedPrompt],
//     queryFn: async () => {
//       let res = await fetch("/api/generateImages", {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({ prompt, userAPIKey }),
//       });

//       if (!res.ok) {
//         throw new Error(await res.text());
//       }
//       return (await res.json()) as {
//         b64_json: string;
//         timings: { inference: number };
//       };
//     },
//     enabled: !!debouncedPrompt.trim(),
//     staleTime: Infinity,
//     retry: false,
//   });

//   let isDebouncing = prompt !== debouncedPrompt;

//   return (
//     <div className="flex h-full flex-col px-5">
//       <header className="flex justify-center pt-20 md:justify-end md:pt-3">
//         <div className="absolute left-1/2 top-6 -translate-x-1/2">
//           <a href="https://www.dub.sh/together-ai" target="_blank">
//             <Logo />
//           </a>
//         </div>
//         <div>
//           <label className="text-xs text-gray-200">
//             [Optional] Add your{" "}
//             <a
//               href="https://api.together.xyz/settings/api-keys"
//               target="_blank"
//               className="underline underline-offset-4 transition hover:text-blue-500"
//             >
//               Together API Key
//             </a>{" "}
//           </label>
//           <Input
//             placeholder="API Key"
//             type="password"
//             value={userAPIKey}
//             className="mt-1 bg-gray-400 text-gray-200 placeholder:text-gray-300"
//             onChange={(e) => setUserAPIKey(e.target.value)}
//           />
//         </div>
//       </header>

//       <div className="flex justify-center">
//         <form className="mt-10 w-full max-w-lg">
//           <fieldset>
//             <div className="relative">
//               <Textarea
//                 rows={4}
//                 spellCheck={false}
//                 placeholder="Describe your image..."
//                 required
//                 value={prompt}
//                 onChange={(e) => setPrompt(e.target.value)}
//                 className="w-full resize-none border-gray-300 border-opacity-50 bg-gray-400 px-4 text-base placeholder-gray-300"
//               />
//               <div
//                 className={`${isFetching || isDebouncing ? "flex" : "hidden"} absolute bottom-3 right-3 items-center justify-center`}
//               >
//                 <Spinner className="size-4" />
//               </div>
//             </div>
//           </fieldset>
//         </form>
//       </div>

//       <div className="flex w-full grow flex-col items-center justify-center pb-8 pt-4 text-center">
//         {!image || !prompt ? (
//           <div className="max-w-xl md:max-w-4xl lg:max-w-3xl">
//             <p className="text-xl font-semibold text-gray-200 md:text-3xl lg:text-4xl">
//               Generate images in real-time
//             </p>
//             <p className="mt-4 text-balance text-sm text-gray-300 md:text-base lg:text-lg">
//               Enter a prompt and generate images in milliseconds as you type.
//               Powered by Flux on Together AI.
//             </p>
//           </div>
//         ) : (
//           <div className="mt-4 flex w-full max-w-4xl justify-center">
//             <div>
//               <Image
//                 placeholder="blur"
//                 blurDataURL={imagePlaceholder.blurDataURL}
//                 width={1024}
//                 height={768}
//                 src={`data:image/png;base64,${image.b64_json}`}
//                 alt=""
//                 className={`${isFetching ? "animate-pulse" : ""} max-w-full rounded-lg object-cover shadow-sm shadow-black`}
//               />
//             </div>
//           </div>
//         )}
//       </div>

//       <footer className="mt-16 w-full items-center pb-10 text-center text-gray-300 md:mt-4 md:flex md:justify-between md:pb-5 md:text-xs lg:text-sm">
//         <p>
//           Powered by{" "}
//           <a
//             href="https://www.dub.sh/together-ai"
//             target="_blank"
//             className="underline underline-offset-4 transition hover:text-blue-500"
//           >
//             Together.ai
//           </a>{" "}
//           &{" "}
//           <a
//             href="https://dub.sh/together-flux"
//             target="_blank"
//             className="underline underline-offset-4 transition hover:text-blue-500"
//           >
//             Flux
//           </a>
//         </p>

//         <div className="mt-8 flex items-center justify-center md:mt-0 md:justify-between md:gap-6">
//           <p className="hidden whitespace-nowrap md:block">
//             100% free and{" "}
//             <a
//               href="https://github.com/Nutlope/blinkshot"
//               target="_blank"
//               className="underline underline-offset-4 transition hover:text-blue-500"
//             >
//               open source
//             </a>
//           </p>

//           <div className="flex gap-6 md:gap-2">
//             <a href="https://github.com/Nutlope/blinkshot" target="_blank">
//               <Button
//                 variant="outline"
//                 size="sm"
//                 className="inline-flex items-center gap-2"
//               >
//                 <GithubIcon className="size-4" />
//                 GitHub
//               </Button>
//             </a>
//             <a href="https://x.com/nutlope" target="_blank">
//               <Button
//                 size="sm"
//                 variant="outline"
//                 className="inline-flex items-center gap-2"
//               >
//                 <XIcon className="size-3" />
//                 Twitter
//               </Button>
//             </a>
//           </div>
//         </div>
//       </footer>
//     </div>
//   );
// }
