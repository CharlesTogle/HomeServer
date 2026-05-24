---
name: Blush & Bloom
colors:
  surface: '#fbf9f7'
  surface-dim: '#dbdad8'
  surface-bright: '#fbf9f7'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3f1'
  surface-container: '#efedec'
  surface-container-high: '#e9e8e6'
  surface-container-highest: '#e4e2e0'
  on-surface: '#1b1c1b'
  on-surface-variant: '#544249'
  inverse-surface: '#30302f'
  inverse-on-surface: '#f2f0ee'
  outline: '#87717a'
  outline-variant: '#dac0c9'
  surface-tint: '#a43073'
  primary: '#a43073'
  on-primary: '#ffffff'
  primary-container: '#f472b6'
  on-primary-container: '#6d0047'
  inverse-primary: '#ffafd3'
  secondary: '#765469'
  on-secondary: '#ffffff'
  secondary-container: '#fdd0ea'
  on-secondary-container: '#79576c'
  tertiary: '#635c61'
  on-tertiary: '#ffffff'
  tertiary-container: '#a69da2'
  on-tertiary-container: '#3a3539'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffd8e7'
  primary-fixed-dim: '#ffafd3'
  on-primary-fixed: '#3d0026'
  on-primary-fixed-variant: '#85145a'
  secondary-fixed: '#ffd8ed'
  secondary-fixed-dim: '#e5bad3'
  on-secondary-fixed: '#2c1325'
  on-secondary-fixed-variant: '#5c3d51'
  tertiary-fixed: '#eae0e6'
  tertiary-fixed-dim: '#cec4ca'
  on-tertiary-fixed: '#1f1a1e'
  on-tertiary-fixed-variant: '#4b454a'
  background: '#fbf9f7'
  on-background: '#1b1c1b'
  surface-variant: '#e4e2e0'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-max: 1280px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 40px
---

## Brand & Style
This design system centers on a soft, approachable, and modern aesthetic. It targets lifestyle, wellness, and social platforms where emotional connection and visual comfort are paramount. The style is a hybrid of **Minimalism** and **Glassmorphism**, utilizing heavy whitespace and translucent layers to prevent the pastel palette from feeling heavy or dated. 

The emotional goal is to evoke a sense of calm, playfulness, and premium softness. UI elements should feel light, almost weightless, floating over cream-toned canvases with gentle depth.

## Colors
The palette is built on a foundation of warm creams and layered pinks. 

- **Primary (#F472B6):** A vibrant but soft "Blush Pink" used for calls to action and active states. It provides the necessary functional contrast against light backgrounds.
- **Secondary (#FBCFE8):** A "Petal Pink" used for soft surfaces, hover states, and tonal accents.
- **Tertiary (#FDF2F8):** "Rose Water," used for large background sections or container fills to provide subtle separation from the base.
- **Neutral (#FFFDFB):** "Cream Shell," the primary background color. It is warmer than pure white to reduce eye strain and maintain the soft narrative.
- **Text:** Use a deep, desaturated plum (#4D2D3D) instead of pure black to maintain harmony with the pink tones while ensuring AAA accessibility.

## Typography
The system exclusively uses **Inter** to maintain a clean, systematic, and modern feel that balances the "sweetness" of the pink palette. Headlines use tighter letter-spacing and heavier weights to create a strong visual anchor. Body text remains functional with generous line heights to ensure the soft color scheme does not compromise legibility. Labels are slightly tracked out when in uppercase to provide a sophisticated, editorial touch.

## Layout & Spacing
This design system utilizes a **fixed-fluid hybrid grid**. The main content container is capped at 1280px, centered on the screen. 

- **Desktop:** 12-column grid with 24px gutters.
- **Tablet:** 8-column grid with 20px gutters.
- **Mobile:** 4-column grid with 16px gutters and 16px side margins.

The spacing rhythm is strictly based on 8px increments. Use generous padding (32px+) inside containers to maintain the "airy" feel of the brand.

## Elevation & Depth
Depth is created through **Tonal Layers** combined with **Ambient Shadows**. Instead of traditional grey shadows, this system uses high-blur, low-opacity shadows tinted with the primary pink color (e.g., `rgba(244, 114, 182, 0.1)`).

1.  **Level 0 (Base):** Cream Shell (#FFFDFB) background.
2.  **Level 1 (Cards):** Rose Water (#FDF2F8) fill with a subtle 1px inner border in Petal Pink.
3.  **Level 2 (Floating):** White fill with a soft pink ambient shadow to represent elevated interactive elements.
4.  **Glassmorphism:** Navigation bars and modals should use a `backdrop-filter: blur(12px)` with a semi-transparent white-pink background (`rgba(255, 255, 255, 0.7)`).

## Shapes
The shape language is consistently **Rounded**. This reinforces the "soft" brand personality. 
- Standard components (buttons, inputs) use a **0.5rem (8px)** radius.
- Larger containers and cards use **1rem (16px)** to emphasize the playful, friendly nature of the UI.
- Feedback tags and small chips use a full pill-shape (999px) to contrast against the more structured card shapes.

## Components
- **Buttons:** Primary buttons use the Blush Pink (#F472B6) fill with white text. Secondary buttons use a Rose Water fill with Blush Pink text. 
- **Input Fields:** Use a subtle Cream Shell fill with a 1px Petal Pink border. On focus, the border thickens and glows with a soft pink shadow.
- **Chips:** Always pill-shaped. Use Rose Water background with Blush Pink text for a monochromatic, sophisticated look.
- **Lists:** Separated by thin Rose Water dividers. Hover states should apply a very soft Cream-to-Pink gradient.
- **Cards:** No harsh borders. Use a soft white background with the tinted ambient shadow defined in the Elevation section.
- **Checkboxes/Radios:** Use the Primary color for the checked state. Maintain high roundedness for checkboxes (4px) and full circles for radios.
