# Architectural rules to be followed during development

## MVVM paradigm
- Views must contain presentation logic only.
- Views must not contain business logic.
- Views must not access data sources directly.
- ViewModels must not depend on concrete UI components.
- Business rules must not be implemented inside Views.
- Models must not depend on the presentation layer.
- Data access must be isolated behind appropriate interfaces.

## Source structure
- view/panel: Code related to the user command panel.
- view/scene: Code related to the 3D simulation scene.
- viewmodel: Code related to the viewmodel.
- model: Code related to the model (every type of element 
  in the scene should have a corresponding model; every 
  element of the model that corresponds to a scene object 
  must derive from SceneNode).
- geometry: general-purpose geometric functions.
- services: Code related to services.

## Test
- test: model and viewmodel testing code.
- e2e: view testing code.
