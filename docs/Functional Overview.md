# Functional Overview

## Key Objectives
Provide a simple, easy to use, spread-sheet-like UX for New Zealand Model flying club competition organisers to 
bulk-enter the raw metrics captured from an NDC (National Distributed Competition) that was run earlier in the 
day, and calculate the scores to determine the placings, so they can inform the contestants. During the NDC 
competition, competitor flight metrics/scores are entered on a paper sheet, which the organiser retrospectively 
enters later that day to determine the final scores and placing before emailing the results to the NDC office
and to the local competitors.


## Key Principles
- Uses the Soarscore back-end scoring system's API to determine competition meta-data, and determine the scores
  and results.
- Serves a single persona: the organiser/CD (contest director). Competitors do not use this UI.
- It is all-at-once bulk-entry retrospectively entered data.
- It must be simple: the user shouldnt need to know the internal complexities of the Soarscore scoring engine
- Provide the absolute minimum of resistence or ceremony and be intuitive
- Used for NDC events only where a more relaxed/informal atmosphere is the norm, with a high level of trust
- Must default what can be defaulted so the organiser doesnt need to enter or even see these options
- Must NOT encode any knowledge of any specific competition class, it must only know about the general case and
  the competition class model and meta data
- Penalties and flight compliance metrics are typically not known about or routinly recorded in NDC events, but 
  should be available as options (2nd-class options)
- teams, protection, independent scorer/signers, and lane assignments etc are absent from NDC competitions

## Basic UX
- There should be a single row per competitor 
- The first two columns are pilot name and MFNZ number
- There should be column per KEY capturable (and non defaulted) metrics (time, landing points, launch height) 
  per comeptitor/group-round
- For tasks whose adopted class definition declares the flightTime + overflySeconds pair (the overfly
  classes), those two inputs become one Flight time column: the organiser enters the single
  launch-to-landing stopwatch reading there and the sheet splits it at the task's working time before capture —
  flightTime = the part inside the working time, overflySeconds = the whole-second excess beyond it. A zero
  overfly is the declared absence and is not captured; correcting a reading amends both sides. There is
  never a separate overfly input.
- The columns are visually grouped by group-round to assist the organiser visually (use differnt colors and/or 
  thicker lines to separate groupings?)
- There should be a single column per comeptitor/group-round which is a multi-choice drop-list containing 
  selectable penalties and flight compliance metrics. This is where all non-key metrics for the task 
  are captured. This is minimise the overall width of the "spreadsheet" matix from growing too wide
- There should be a single "Clear all" button at the end
- There should be a single "Calculate" button underneath the spreadsheet which calculates everything all in one-go
- There should be a single "Clear" button underneath the spreadsheet to reset the sheet

### Workflow
The basic "A-path" user work-flow is:
1, select the competition class
2, Add the name of the contest
3, Add the date of the contest
4, Add the location of the contest

Once the competition class is selected, the app renders the grid with the competition class specific columns, 
penalties and compliance metrics appropriate for the selected competition class - these vary between classes
so are not known at build-time. Then:
 
5, the Organiser retrospective copies data/metrics captured on paper from the contest to the spreadsheet
6, clicks calculate. The system then orchestrates Soarscore transparently behind the scenes and shows the 
  results at each group-round and then the overall results.





