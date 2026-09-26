<!-- A watch that failed, as one of a watch message's blocks: sent once, and not again until a run succeeds. {{reason}} is what went wrong, {{stderr}} the end of what it wrote to stderr. -->

<firstmate-watch name="{{name}}" ran="{{ran}}" failed="{{reason}}">
The watch script failed. This is said once; it is quiet until a run succeeds. The end of its stderr:
{{stderr}}
</firstmate-watch>
