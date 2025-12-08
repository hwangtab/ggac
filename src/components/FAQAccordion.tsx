'use client'

import { useState } from 'react'
import { FiChevronDown } from 'react-icons/fi'

interface FAQ {
  id: string
  question: string
  answer: string
}

interface FAQAccordionProps {
  faqs: FAQ[]
}

export default function FAQAccordion({ faqs }: FAQAccordionProps) {
  const [openId, setOpenId] = useState<string | null>(null)

  const toggleFAQ = (id: string) => {
    setOpenId(openId === id ? null : id)
  }

  return (
    <div className="space-y-4">
      {faqs.map(faq => (
        <div
          key={faq.id}
          className="bg-white/70 backdrop-blur-sm rounded-lg shadow-md border border-white/20 overflow-hidden transition-all duration-200 hover:shadow-lg"
        >
          <button
            onClick={() => toggleFAQ(faq.id)}
            className="w-full px-6 py-4 text-left flex items-center justify-between gap-4 hover:bg-primary-50/50 transition-colors duration-200"
            aria-expanded={openId === faq.id}
          >
            <span className="font-medium text-gray-900 flex-1">{faq.question}</span>
            <FiChevronDown
              className={`w-5 h-5 text-primary-600 transition-transform duration-200 flex-shrink-0 ${
                openId === faq.id ? 'transform rotate-180' : ''
              }`}
            />
          </button>
          <div
            className={`overflow-hidden transition-all duration-200 ${
              openId === faq.id ? 'max-h-96' : 'max-h-0'
            }`}
          >
            <div className="px-6 py-4 text-gray-700 border-t border-gray-200">{faq.answer}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
