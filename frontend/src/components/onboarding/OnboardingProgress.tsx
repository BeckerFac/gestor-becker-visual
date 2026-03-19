import React from 'react'

interface Step {
  id: number
  label: string
  required: boolean
}

interface OnboardingProgressProps {
  steps: Step[]
  currentStep: number
}

export const OnboardingProgress: React.FC<OnboardingProgressProps> = ({ steps, currentStep }) => {
  return (
    <div className="flex items-center justify-between">
      {steps.map((step, index) => {
        const isCompleted = currentStep > step.id
        const isCurrent = currentStep === step.id
        const isUpcoming = currentStep < step.id

        return (
          <React.Fragment key={step.id}>
            <div className="flex flex-col items-center gap-1.5 min-w-0">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-300 ${
                  isCompleted
                    ? 'border-green-500 bg-green-500 text-white'
                    : isCurrent
                    ? 'border-blue-600 bg-blue-600 text-white scale-110'
                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-400'
                }`}
              >
                {isCompleted ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  step.id
                )}
              </div>
              <span
                className={`text-[10px] font-medium text-center leading-tight hidden sm:block ${
                  isCurrent
                    ? 'text-blue-600 dark:text-blue-400'
                    : isCompleted
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-gray-400 dark:text-gray-500'
                }`}
              >
                {step.label}
                {!step.required && (
                  <span className="block text-[8px] text-gray-400">(opcional)</span>
                )}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-1.5 rounded transition-colors duration-300 ${
                  currentStep > step.id
                    ? 'bg-green-400'
                    : 'bg-gray-200 dark:bg-gray-700'
                }`}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
