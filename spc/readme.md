http://snesmusic.org/v2/players.php 참고

This archive consists of complete soundtracks in SPC format packaged in RAR files. Please note that those SPC files are *not* "PKCS #7 Certificates" but custom audio files and that you first need to download a player to play them back. All archives are RAR files (version 3) renamed to RSN, you can easily rename them back to RAR and open them with your favorite program capable of opening and viewing standard RAR files.

SPC files are memory dumps from the SPC700, which again is a custom CPU in the SNES designed and manufactured by Sony controlling a separate DSP chip for producing sound. Read on about how sound on the SNES works.

Recommended software players
For best reproduction of the SPC files offered on this site we recommend players based on Alpha-II's SNESAPU engine as well as supporting the (extended) ID666 tag format.

Windows
The SNESAmp plugin is the premier player using SNESAPU and our reference player. It works in Winamp and XMPlay. The former combination allows you to open RSN files directly without having to decompress it first, the latter needs you to add the xmp-rar plugin to have this feature.
You can also open RSN files with Super Jukebox (for older versions you might need to rename the files to RAR first).
There is also the Japanese SNES SPC700 Player which adds support for Script700 often used in Japan.
There is also the plugin kbsnesapu for the popular Japanese KbMedia Player.
Foobar2000 supports playback of SPC files (also from archive files) including reading and (starting with foo_gep v1.63) writing (extended) ID666 while simulatenously continuing to write its own APEv2 tags not interpreted by any other SPC player.
Linux/Unix
For XMMS there is the SNESAPU based sexyspc which offers many features SNESAmp has.
The rather new XMMS/Beep successor Audacious includes the OpenSPC based Game_Music_Box engine as default plugin.
GStreamer's Bad Plug-ins 0.10.4 "Black Bugs" includes support for SPC.
For KDE there is kfile_spc which makes ID666 tags in SPC files accessible and editable for all KDE applications (however no extended ID666 tags support currently).
Macintosh
An universal game music formats player called Game Music Box which includes support for RSN files is available for OS X and OS 9.
For editing ID666 and extended ID6 tags of SPC files under OS X there is the ID666 Tag Editor.
Multiplatform
Audio Overload is the universal player for emulated formats available for Macintosh, Windows, Linux x86-32 and Linux x86-64, this player can play the archive files directly.
vspcplay is an open source player with an informative graphical text mode interface and supports extended ID666 as well as sending the SPC data to authentic hardware for playback (see Playback on authentic hardware topic below). A pre-compiled version for Windows exists.
Portable Players
Based on Game Music Box ROCKbox open source jukebox firmware supports playing back SPC files on iPod and other portable MP3 players starting with version 3.0.
Playback on authentic hardware
If you own a SNES copier you can now enjoy the true SNES sound of all SPC files with the help of the SPC2ROM converter.
You can also create your own external SNES Audio Unit, Linux software and additional experience is also available.
In both cases a digital S/PDIF output can also be added.
Converting SPC files
You can convert SPC files to WAV using Super Jukebox and WAV, MP3, OGG, WMA etc. using Winamp.
In case you are sick of those short 8.3 style file names of all SPC files in this archive you can use SPC Renamer for renaming all files into your prefered naming scheme in one rush. Under KDE you can do the same with KRename after you have installed the above mentioned kfile_spc.
NEW! If you want to keep the sets as RSN files but would prefer the full game names instead the cryptic project titles as filename you can use renset v.0.6 together with the latest rsnsets dat file (up-to-date as of January 11th) to automatically rename the files.
You can also export SPC files as MIDI files, export its containing samples and even replace existing samples with your own recordings using SPC Tool for DOS.