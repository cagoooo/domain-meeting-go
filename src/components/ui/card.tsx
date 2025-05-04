import * as React from "react"

import { cn } from "@/lib/utils"

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-lg border bg-card text-card-foreground shadow-md transition-shadow duration-200 hover:shadow-lg", // Increased shadow and added transition
      className
    )}
    {...props}
  />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

// Updated CardTitle to ensure consistent styling
const CardTitle = React.forwardRef<
  HTMLHeadingElement, // Changed element type to heading for semantics
  React.HTMLAttributes<HTMLHeadingElement> // Changed attribute type
>(({ className, ...props }, ref) => (
  <h2 // Use h2 or appropriate heading level
    ref={ref}
    className={cn(
      "text-2xl font-semibold leading-none tracking-tight text-card-foreground", // Ensure text color matches card foreground
      className
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

// Updated CardDescription to ensure consistent styling
const CardDescription = React.forwardRef<
  HTMLParagraphElement, // Changed element type to paragraph for semantics
  React.HTMLAttributes<HTMLParagraphElement> // Changed attribute type
>(({ className, ...props }, ref) => (
  <p // Use p for description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)} // Use muted-foreground for description
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
